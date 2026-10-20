/**
 * Cancelling unpaid print jobs against a disposable database, through the real routes, transactions
 * and print payment lifecycle. Nothing calls OPay: failures go through failPendingPayment, pending
 * reconciliation uses an injected provider record, and successes use the harness's trusted fixture.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  callRoute,
  cleanupTestData,
  createTestLocation,
  createTestUser,
  dbTestSkip as skip,
  signInAs,
  testDb,
  trustedTestVerifiedPayment,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { VerificationDeps } from "../payments/opay-verification";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  uploads: typeof import("../../app/api/print-jobs/uploads/route");
  prepare: typeof import("../../app/api/print-jobs/[id]/prepare/route");
  cancel: typeof import("../../app/api/print-jobs/[id]/cancel/route");
  payment: typeof import("../../app/api/print-jobs/[id]/payment/route");
  adminPrint: typeof import("../../app/api/admin/print-jobs/[id]/route");
  service: typeof import("./service");
  payments: typeof import("../payments/payment-lifecycle");
  rules: typeof import("./print-cancellation");
  store: typeof import("./print-cancellation-store");
  opayDeps: typeof import("../payments/checkout-cancellation-store");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [uploads, prepare, cancel, payment, adminPrint, service, payments, rules, store, opayDeps] = await Promise.all([
    import("../../app/api/print-jobs/uploads/route"),
    import("../../app/api/print-jobs/[id]/prepare/route"),
    import("../../app/api/print-jobs/[id]/cancel/route"),
    import("../../app/api/print-jobs/[id]/payment/route"),
    import("../../app/api/admin/print-jobs/[id]/route"),
    import("./service"),
    import("../payments/payment-lifecycle"),
    import("./print-cancellation"),
    import("./print-cancellation-store"),
    import("../payments/checkout-cancellation-store"),
  ]);
  app = { db, uploads, prepare, cancel, payment, adminPrint, service, payments, rules, store, opayDeps };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;
const configuration = { paperSize: "A4", colorMode: "BLACK_AND_WHITE", sides: "DOUBLE", copies: 2, pageSelection: "1-5", instructions: "Staple top-left" };

/** Real draft and pricing; the verified upload row is the only fixture (see print-journey.db-test.ts). */
async function preparedPrintJob(student: User) {
  signInAs(student);
  const draft = await callRoute(app.uploads.POST, { method: "POST" });
  assert.equal(draft.status, 201, JSON.stringify(draft.json?.error));
  const printJobId = draft.json.printJobId as string;
  await app.db.printDocument.create({
    data: { printJobId, uploadedById: student.userId, publicId: `packam/print-jobs/${printJobId}.pdf`, originalFileName: "synthetic-cancel-test.pdf", mimeType: "application/pdf", fileSize: 48_000, pageCount: 8 },
  });
  const location = await createTestLocation(student.userId);
  signInAs(student);
  const prepared = await callRoute(app.prepare.POST, { method: "POST", params: { id: printJobId }, body: { configuration, deliveryLocationId: location.id } });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.json?.error));
  return printJobId;
}

async function failedAttempt(student: User, printJobId: string) {
  const attempt = await app.service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, randomUUID());
  assert.equal(await app.payments.failPendingPayment(attempt.transactionReference!), true);
  return attempt;
}

function cancelAs(user: User | null, printJobId: string) {
  signInAs(user);
  return callRoute(app.cancel.POST, { method: "POST", params: { id: printJobId } });
}

function verificationReturning(status: string, attempt: { transactionReference: string | null; amount: number }): VerificationDeps {
  return {
    ...app.opayDeps.opayStatusDeps,
    queryStatus: async () => ({ reference: attempt.transactionReference!, transactionId: `TEST-NO-MONEY-${randomUUID()}`, status, amount: { total: attempt.amount * 100, currency: "NGN" } }),
  };
}

const jobStatus = async (printJobId: string) => (await app.db.printJob.findUniqueOrThrow({ where: { id: printJobId }, select: { status: true } })).status;

test("failed payment → Cancel Print Job: cancelled once, audited, unpayable and hidden from paid jobs", { skip }, async () => {
  const { db, service } = app;
  const student = await createTestUser("STUDENT");
  const printJobId = await preparedPrintJob(student);
  const attempt = await failedAttempt(student, printJobId);

  const results = await Promise.all([1, 2, 3].map(() => cancelAs(student, printJobId)));
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(results.filter((r) => r.json.alreadyCancelled === false).length, 1, "duplicate requests cancel once");
  assert.equal(await jobStatus(printJobId), "CANCELLED");
  assert.equal(await db.printJobStatusHistory.count({ where: { printJobId, status: "CANCELLED" } }), 1);
  assert.equal(await db.auditLog.count({ where: { resource: "PrintJob", resourceId: printJobId, action: "PRINT_UNPAID_CANCELLED", actorId: student.userId } }), 1);
  assert.equal(await db.notification.count({ where: { userId: student.userId, idempotencyKey: `print-job-cancelled:${printJobId}` } }), 1);
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: attempt.id } })).status, "FAILED", "the payment record is left as OPay reported it");

  // A cancelled job can't start a new payment, and an old attempt can't be handed a checkout link.
  await assert.rejects(service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, randomUUID()), /not ready for payment/i);
  signInAs(student);
  const resumed = await callRoute(app.payment.POST, { method: "POST", params: { id: printJobId }, headers: { "Idempotency-Key": attempt.idempotencyKey! } });
  assert.equal(resumed.status, 409);
  assert.equal(resumed.json.cashierUrl, undefined);
  assert.equal((await service.listStudentPaidPrintJobs(student.userId)).some((job) => job.id === printJobId), false);
});

test("failed payment → Try Again: the same job gets a new attempt and is fulfilled once", { skip }, async () => {
  const { db, service, payments } = app;
  const student = await createTestUser("STUDENT");
  const printJobId = await preparedPrintJob(student);
  const first = await failedAttempt(student, printJobId);
  const retry = await service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, randomUUID());
  assert.notEqual(retry.id, first.id);
  const verified = trustedTestVerifiedPayment(retry);
  await payments.completeVerifiedPayment(verified);
  await payments.completeVerifiedPayment(verified);
  assert.equal(await jobStatus(printJobId), "FINDING_RUNNER");
  assert.equal(await db.printJob.count({ where: { userId: student.userId } }), 1, "retrying never creates a second job");
  assert.equal(await db.payment.count({ where: { printJobId, status: "SUCCESS" } }), 1);

  const refused = await cancelAs(student, printJobId);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.status, "SUCCESS");
  assert.doesNotMatch(JSON.stringify(refused.json), /refund/i);
  assert.equal(await jobStatus(printJobId), "FINDING_RUNNER");
});

test("late success callbacks after cancellation are kept for review, alerted once and never fulfilled", { skip }, async () => {
  const { db, payments } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const printJobId = await preparedPrintJob(student);
  const attempt = await failedAttempt(student, printJobId);
  assert.equal((await cancelAs(student, printJobId)).status, 200);

  const late = trustedTestVerifiedPayment(attempt);
  for (let callback = 0; callback < 3; callback += 1) {
    await assert.rejects(payments.completeVerifiedPayment(late), (error: unknown) => error instanceof Error && error.name === "PrintPaymentNeedsReviewError");
  }
  assert.equal(await jobStatus(printJobId), "CANCELLED");
  assert.equal(await db.runnerAssignment.count({ where: { printJobId } }), 0, "no runner is ever offered a cancelled job");
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: attempt.id } })).status, "RECONCILIATION_REQUIRED");
  assert.equal(await db.notification.count({ where: { userId: admin.userId, relatedId: printJobId, title: "Payment received for a cancelled print job" } }), 1);
  const studentNotice = await db.notification.findMany({ where: { userId: student.userId, relatedId: printJobId, title: "Payment received for a cancelled print job" }, select: { message: true } });
  assert.equal(studentNotice.length, 1);
  assert.doesNotMatch(studentNotice[0].message, /refunded|second payment/i, "no refund claim and not described as a duplicate");
  assert.equal(await db.notification.count({ where: { userId: student.userId, title: "We received an extra payment" } }), 0);
});

test("pending payment: cancelled only after OPay verifies it closed; paid payments keep the job", { skip }, async () => {
  const { service, rules, store } = app;
  const student = await createTestUser("STUDENT");
  const actor = { id: student.userId, role: "STUDENT" as const };

  const pendingJob = await preparedPrintJob(student);
  const pending = await service.createPrintPaymentAttempt("OPAY", student.userId, pendingJob, randomUUID());
  assert.deepEqual(await rules.cancelUnpaidPrintJob(store.printCancellationDeps(pendingJob, actor, verificationReturning("PENDING", pending))), { kind: "STILL_PENDING" });
  assert.equal(await jobStatus(pendingJob), "READY_FOR_PAYMENT");
  assert.equal((await app.db.payment.findUniqueOrThrow({ where: { id: pending.id } })).status, "PENDING", "never failed while uncertain");
  assert.deepEqual(await rules.cancelUnpaidPrintJob(store.printCancellationDeps(pendingJob, actor, verificationReturning("CLOSE", pending))), { kind: "CANCELLED", alreadyCancelled: false });
  assert.equal(await jobStatus(pendingJob), "CANCELLED");

  const paidJob = await preparedPrintJob(student);
  const paid = await service.createPrintPaymentAttempt("OPAY", student.userId, paidJob, randomUUID());
  assert.deepEqual(await rules.cancelUnpaidPrintJob(store.printCancellationDeps(paidJob, actor, verificationReturning("SUCCESS", paid))), { kind: "PAID" });
  assert.equal(await jobStatus(paidJob), "FINDING_RUNNER");
});

test("only the owner or an admin can cancel; runners, other students and signed-out users cannot", { skip }, async () => {
  const student = await createTestUser("STUDENT");
  const other = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  const admin = await createTestUser("ADMIN");
  const printJobId = await preparedPrintJob(student);
  await failedAttempt(student, printJobId);

  assert.equal((await cancelAs(null, printJobId)).status, 401);
  assert.equal((await cancelAs(runner, printJobId)).status, 403);
  assert.equal((await cancelAs(other, printJobId)).status, 404);
  assert.equal((await cancelAs(admin, printJobId)).status, 403, "admins use the operations route");
  signInAs(other);
  assert.equal((await callRoute(app.adminPrint.POST, { method: "POST", params: { id: printJobId }, body: { action: "cancel-unpaid" } })).status, 403);
  assert.equal(await jobStatus(printJobId), "READY_FOR_PAYMENT");

  signInAs(admin);
  const byAdmin = await callRoute(app.adminPrint.POST, { method: "POST", params: { id: printJobId }, body: { action: "cancel-unpaid" } });
  assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.json));
  assert.equal(await jobStatus(printJobId), "CANCELLED");
  assert.equal(await app.db.auditLog.count({ where: { resourceId: printJobId, action: "PRINT_UNPAID_CANCELLED", actorId: admin.userId } }), 1);
});
