/**
 * Printing journey against a disposable database, through the real routes and services:
 * draft → (verified document fixture) → quote → prepare → payment attempt → trusted test payment
 * boundary → offers → competing acceptance → private document access → lifecycle → tracking,
 * plus failure recovery, timeouts and cross-role access.
 *
 * Boundary: the PDF upload itself goes to Cloudinary (uploaded and re-verified server-side by
 * upload-complete). Tests never upload to the real storage account, so the verified PrintDocument
 * row is created as a fixture. PDF validation is covered by document-validation.test.ts.
 */
import {
  asUser,
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

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  uploads: typeof import("../../app/api/print-jobs/uploads/route");
  quote: typeof import("../../app/api/print-jobs/[id]/quote/route");
  prepare: typeof import("../../app/api/print-jobs/[id]/prepare/route");
  mission: typeof import("../../app/api/runner/print-missions/[id]/route");
  documentRoute: typeof import("../../app/api/runner/print-missions/[id]/document/route");
  adminPrint: typeof import("../../app/api/admin/print-jobs/[id]/route");
  missions: typeof import("../../app/api/runner/missions/route");
  service: typeof import("./service");
  runnerService: typeof import("./runner-service");
  recovery: typeof import("./fulfilment-recovery");
  payments: typeof import("../payments/payment-lifecycle");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [uploads, quote, prepare, mission, documentRoute, adminPrint, missions, service, runnerService, recovery, payments] = await Promise.all([
    import("../../app/api/print-jobs/uploads/route"),
    import("../../app/api/print-jobs/[id]/quote/route"),
    import("../../app/api/print-jobs/[id]/prepare/route"),
    import("../../app/api/runner/print-missions/[id]/route"),
    import("../../app/api/runner/print-missions/[id]/document/route"),
    import("../../app/api/admin/print-jobs/[id]/route"),
    import("../../app/api/runner/missions/route"),
    import("./service"),
    import("./runner-service"),
    import("./fulfilment-recovery"),
    import("../payments/payment-lifecycle"),
  ]);
  app = { db, uploads, quote, prepare, mission, documentRoute, adminPrint, missions, service, runnerService, recovery, payments };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;
const configuration = { paperSize: "A4", colorMode: "BLACK_AND_WHITE", sides: "DOUBLE", copies: 2, pageSelection: "1-5", instructions: "Staple top-left" };

/** Real draft creation and pricing; the verified upload is the only fixture. */
async function preparedPrintJob(student: User) {
  signInAs(student);
  const draft = await callRoute(app.uploads.POST, { method: "POST" });
  assert.equal(draft.status, 201, JSON.stringify(draft.json?.error));
  const printJobId = draft.json.printJobId as string;
  await app.db.printDocument.create({
    data: {
      printJobId,
      uploadedById: student.userId,
      publicId: `packam/print-jobs/${printJobId}.pdf`,
      originalFileName: "synthetic-test-notes.pdf",
      mimeType: "application/pdf",
      fileSize: 48_000,
      pageCount: 8,
    },
  });
  const location = await createTestLocation(student.userId);
  signInAs(student);
  const prepared = await callRoute(app.prepare.POST, { method: "POST", params: { id: printJobId }, body: { configuration, deliveryLocationId: location.id } });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.json?.error));
  return { printJobId, location, prepared: prepared.json.printJob as { total: number; printSubtotal: number; deliveryFee: number } };
}

async function paidPrintJob(student: User) {
  const { printJobId } = await preparedPrintJob(student);
  const attempt = await app.service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, randomUUID());
  await app.payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));
  return printJobId;
}

test("print pricing is computed by the server and the browser cannot change the paid amount", { skip }, async () => {
  const { db, quote, prepare, service } = app;
  const student = await createTestUser("STUDENT");
  const other = await createTestUser("STUDENT");
  const { printJobId, location, prepared } = await preparedPrintJob(student);

  // Agreed example: 5 pages × 2 copies × ₦100 (B&W, double-sided same price) + ₦200 delivery = ₦1,200.
  assert.equal(prepared.total, 1_200);
  assert.equal(prepared.printSubtotal, 1_000);
  assert.equal(prepared.deliveryFee, 200);
  signInAs(student);
  const colour = await callRoute(quote.POST, { method: "POST", params: { id: printJobId }, body: { configuration: { ...configuration, colorMode: "COLOR" } } });
  assert.equal(colour.status, 200);
  assert.equal((colour.json.quote as { total: number }).total, 5 * 2 * 300 + 200);

  // Invalid settings are rejected; client-sent prices are ignored.
  for (const bad of [{ copies: 0 }, { pageSelection: "9-12" }, { colorMode: "NEON" }]) {
    const response = await callRoute(quote.POST, { method: "POST", params: { id: printJobId }, body: { configuration: { ...configuration, ...bad } } });
    assert.equal(response.status, 400, JSON.stringify(bad));
  }
  const tampered = await callRoute(prepare.POST, { method: "POST", params: { id: printJobId }, body: { configuration, deliveryLocationId: location.id, total: 1, pricePerPage: 0 } });
  assert.equal(tampered.status, 200);
  assert.equal((tampered.json.printJob as { total: number }).total, 1_200);

  // Another student can't price, prepare or pay for this job.
  signInAs(other);
  assert.equal((await callRoute(quote.POST, { method: "POST", params: { id: printJobId }, body: { configuration } })).status, 404);
  await assert.rejects(service.createPrintPaymentAttempt("OPAY", other.userId, printJobId, randomUUID()));

  const key = randomUUID();
  const attempt = await service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, key);
  assert.equal(attempt.amount, 1_200);
  assert.equal((await service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, key)).id, attempt.id, "retry reuses the attempt");
  // Editing the stored snapshot after preparing must not let a different amount through.
  await db.printJob.update({ where: { id: printJobId }, data: { total: 5 } });
  await assert.rejects(app.payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt)));
  assert.equal((await db.printJob.findUniqueOrThrow({ where: { id: printJobId }, select: { status: true } })).status, "READY_FOR_PAYMENT", "unverifiable payment never starts fulfilment");
});

test("paid print job: offers, competing acceptance, private document access, lifecycle and tracking", { skip }, async () => {
  const { db, mission, documentRoute, missions, service, runnerService, payments } = app;
  const student = await createTestUser("STUDENT");
  const otherStudent = await createTestUser("STUDENT");
  const runners = await Promise.all(Array.from({ length: 5 }, () => createTestUser("RUNNER", { isVerified: true, isAvailable: true })));
  const unverified = await createTestUser("RUNNER", { isVerified: false, isAvailable: true });

  const { printJobId } = await preparedPrintJob(student);
  const attempt = await service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, randomUUID());
  assert.equal(await db.runnerAssignment.count({ where: { printJobId } }), 0, "no offers before payment is verified");
  const verified = trustedTestVerifiedPayment(attempt);
  await Promise.all([payments.completeVerifiedPayment(verified), payments.completeVerifiedPayment(verified)]);
  await payments.completeVerifiedPayment(verified);
  const job = await db.printJob.findUniqueOrThrow({ where: { id: printJobId }, select: { status: true, orderId: true } });
  assert.deepEqual(job, { status: "FINDING_RUNNER", orderId: null }, "no fake marketplace order");
  const offered = await db.runnerAssignment.findMany({ where: { printJobId }, select: { runnerId: true } });
  assert.ok(runners.every((r) => offered.some((o) => o.runnerId === r.runnerId)), "eligible runners offered");
  assert.ok(!offered.some((o) => o.runnerId === unverified.runnerId), "unverified runner not offered");
  assert.equal(await db.printJobStatusHistory.count({ where: { printJobId, status: "FINDING_RUNNER" } }), 1, "duplicate callbacks add no history");

  // Offered runners see settings but not the document or address, and cannot download.
  signInAs(runners[0]);
  const offeredView = await callRoute(mission.GET, { params: { id: printJobId } });
  assert.equal(offeredView.status, 200);
  assert.equal("deliveryAddress" in (offeredView.json.mission as object), false);
  assert.equal((await callRoute(documentRoute.GET, { params: { id: printJobId } })).status, 404, "offered runner cannot download");
  const list = await callRoute(missions.GET);
  assert.doesNotMatch(JSON.stringify(list.json), /print-jobs\/|cloudinary|https?:\/\//i, "mission list carries no storage URLs");

  const results = await Promise.all(runners.map((runner) =>
    asUser(runner, () => callRoute(mission.POST, { method: "POST", params: { id: printJobId }, body: { action: "accept" } }))));
  const winners = results.flatMap((r, i) => r.status === 200 ? [runners[i]] : []);
  assert.equal(winners.length, 1, `exactly one winner: ${JSON.stringify(results.map((r) => r.status))}`);
  const [winner] = winners;
  const loser = runners.find((r) => r.runnerId !== winner.runnerId)!;

  // Document access: only the winner. Unauthenticated, students and losers are refused.
  signInAs(null);
  assert.equal((await callRoute(documentRoute.GET, { params: { id: printJobId } })).status, 401);
  signInAs(student);
  assert.equal((await callRoute(documentRoute.GET, { params: { id: printJobId } })).status, 403);
  signInAs(loser);
  assert.equal((await callRoute(documentRoute.GET, { params: { id: printJobId } })).status, 404);
  assert.equal((await callRoute(mission.GET, { params: { id: printJobId } })).status, 404, "loser can't view the mission");
  const access = await runnerService.authorizePrintDocumentAccess(winner.userId, printJobId);
  assert.equal(access.fileName, "synthetic-test-notes.pdf");
  const accessAudit = await db.auditLog.findMany({ where: { resourceId: printJobId, action: "PRINT_DOCUMENT_ACCESSED" }, select: { newState: true, details: true } });
  assert.equal(accessAudit.length, 1);
  assert.doesNotMatch(JSON.stringify(accessAudit), /https?:\/\/|signature|api_key/i, "audit never stores the signed URL");
  assert.doesNotMatch(JSON.stringify(await db.notification.findMany({ where: { relatedId: printJobId }, select: { title: true, message: true } })), /https?:\/\/|print-jobs\//i);

  // Lifecycle through the API, with duplicate clicks and a skipped step.
  signInAs(winner);
  const act = (action: string) => callRoute(mission.POST, { method: "POST", params: { id: printJobId }, body: { action } });
  assert.equal((await act("printed")).status, 409, "can't skip ahead");
  for (const action of ["document-received", "document-received", "start-printing", "printed", "start-delivery", "delivered", "delivered"]) {
    const result = await act(action);
    assert.equal(result.status, 200, `${action}: ${result.json?.error}`);
  }
  signInAs(loser);
  assert.equal((await callRoute(mission.POST, { method: "POST", params: { id: printJobId }, body: { action: "delivered" } })).status, 404, "loser can't mutate");
  const history = await db.printJobStatusHistory.groupBy({ by: ["status"], where: { printJobId }, _count: true });
  for (const entry of history) assert.equal(entry._count, 1, `${entry.status} recorded once`);
  assert.equal((await db.printJob.findUniqueOrThrow({ where: { id: printJobId }, select: { status: true } })).status, "DELIVERED");
  assert.equal((await db.runnerAssignment.findFirstOrThrow({ where: { printJobId, runnerId: winner.runnerId }, select: { status: true } })).status, "COMPLETED");
  signInAs(winner);
  assert.equal((await callRoute(documentRoute.GET, { params: { id: printJobId } })).status, 404, "document access closes after printing");

  // Student tracking: owner sees DELIVERED and notifications; nobody else can read it.
  const tracking = await service.getStudentPrintTracking(student.userId, printJobId);
  assert.equal(tracking?.status, "DELIVERED");
  assert.doesNotMatch(JSON.stringify(tracking), /publicId|print-jobs\//, "tracking carries no storage identifiers");
  assert.equal(await service.getStudentPrintTracking(otherStudent.userId, printJobId), null);
  const studentNotes = await db.notification.findMany({ where: { userId: student.userId, relatedId: printJobId }, select: { title: true } });
  for (const title of ["Print payment confirmed", "Print runner assigned", "Print job delivered"]) {
    assert.equal(studentNotes.filter((n) => n.title === title).length, 1, title);
  }
});

test("print failures recover through operations, and admin actions stay admin-only", { skip }, async () => {
  const { db, mission, adminPrint } = app;
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const admin = await createTestUser("ADMIN");
  const printJobId = await paidPrintJob(student);

  signInAs(runner);
  const act = (body: Record<string, unknown>) => callRoute(mission.POST, { method: "POST", params: { id: printJobId }, body });
  assert.equal((await act({ action: "accept" })).status, 200);
  assert.equal((await act({ action: "document-received" })).status, 200);
  assert.equal((await act({ action: "start-printing" })).status, 200);
  const failed = await act({ action: "print-failed", note: "Printer jammed \u0000 twice" });
  assert.equal(failed.status, 200);
  assert.equal((await act({ action: "start-printing" })).status, 409, "a failed job can't continue without operations");
  assert.ok(await db.notification.count({ where: { userId: admin.userId, relatedId: printJobId } }) > 0, "operations alerted");

  for (const user of [student, runner]) {
    signInAs(user);
    assert.equal((await callRoute(adminPrint.POST, { method: "POST", params: { id: printJobId }, body: { action: "retry" } })).status, 403);
  }
  signInAs(admin);
  assert.equal((await callRoute(adminPrint.POST, { method: "POST", params: { id: printJobId }, body: { action: "retry" } })).status, 200);
  signInAs(runner);
  for (const action of ["document-received", "start-printing", "printed"]) assert.equal((await act({ action })).status, 200, action);

  // Operations can still stop a job and move it to refund processing; nothing claims it was refunded.
  signInAs(admin);
  const refund = await callRoute(adminPrint.POST, { method: "POST", params: { id: printJobId }, body: { action: "refund" } });
  assert.equal(refund.status, 200);
  const stopped = await db.printJob.findUniqueOrThrow({ where: { id: printJobId }, select: { status: true } });
  assert.equal(stopped.status, "REFUND_PROCESSING");
  assert.equal(await db.runnerAssignment.count({ where: { printJobId, status: { in: ["OFFERED", "ACCEPTED"] } } }), 0);
  signInAs(runner);
  assert.equal((await act({ action: "start-delivery" })).status, 404, "a cancelled runner can't continue");
});

test("unaccepted print jobs time out into refund processing exactly once", { skip }, async () => {
  const { db, recovery, mission } = app;
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const printJobId = await paidPrintJob(student);
  await db.printJob.update({ where: { id: printJobId }, data: { findingRunnerAt: new Date(Date.now() - 24 * 60 * 60_000) } });

  signInAs(runner);
  assert.equal((await callRoute(mission.POST, { method: "POST", params: { id: printJobId }, body: { action: "accept" } })).status, 409, "expired offer can't be accepted");
  await recovery.expireUnclaimedPrintJobs();
  await recovery.expireUnclaimedPrintJobs();
  const job = await db.printJob.findUniqueOrThrow({ where: { id: printJobId }, select: { status: true } });
  assert.equal(job.status, "REFUND_PROCESSING");
  assert.equal(await db.printJobStatusHistory.count({ where: { printJobId, status: "REFUND_PROCESSING" } }), 1);
  assert.equal(await db.notification.count({ where: { userId: student.userId, relatedId: printJobId, title: "Print refund processing" } }), 1);
});

test("the database still refuses a successful payment that is linked to nothing", { skip }, async () => {
  const { db } = app;
  const student = await createTestUser("STUDENT");
  const violates = (error: unknown) => /Payment_success_requires_fulfilment_root_check/.test(String(error));
  await assert.rejects(db.payment.create({
    data: { userId: student.userId, provider: "OPAY", status: "SUCCESS", amount: 500, currency: "NGN", transactionReference: `packam_${randomUUID()}`, idempotencyKey: randomUUID() },
  }), violates);
  const pending = await db.payment.create({
    data: { userId: student.userId, provider: "OPAY", status: "PENDING", amount: 500, currency: "NGN", transactionReference: `packam_${randomUUID()}`, idempotencyKey: randomUUID() },
    select: { id: true },
  });
  await assert.rejects(db.payment.update({ where: { id: pending.id }, data: { status: "SUCCESS" } }), violates);
});

test("a payment can never reference both an order and a print job", { skip }, async () => {
  const { db } = app;
  const student = await createTestUser("STUDENT");
  const printJobId = await paidPrintJob(student);
  const order = await db.order.create({
    data: { userId: student.userId, status: "FINDING_RUNNER", subtotal: 1_000, deliveryFee: 200, total: 1_200, deliveryAddress: "Test hall" },
    select: { id: true },
  });
  const violates = (error: unknown) => /Payment_single_fulfilment_root_check/.test(String(error));
  for (const status of ["PENDING", "SUCCESS", "FAILED"] as const) {
    await assert.rejects(db.payment.create({
      data: { userId: student.userId, orderId: order.id, printJobId, provider: "OPAY", status, amount: 1_200, currency: "NGN", transactionReference: `packam_${randomUUID()}`, idempotencyKey: randomUUID() },
    }), violates, status);
  }
  const printPayment = await db.payment.findFirstOrThrow({ where: { printJobId, status: "SUCCESS" }, select: { id: true } });
  await assert.rejects(db.payment.update({ where: { id: printPayment.id }, data: { orderId: order.id } }), violates);
});

test("a print job can never have two successful payment records", { skip }, async () => {
  const { db } = app;
  const student = await createTestUser("STUDENT");
  const printJobId = await paidPrintJob(student);
  const unique = (error: unknown) => /Payment_one_success_per_print_job|Unique constraint/.test(String(error));
  await assert.rejects(db.payment.create({
    data: { userId: student.userId, printJobId, provider: "OPAY", status: "SUCCESS", amount: 1_200, currency: "NGN", transactionReference: `packam_${randomUUID()}`, idempotencyKey: randomUUID() },
  }), unique);
  // Retries are still allowed: extra attempts may exist in any non-success state.
  const retry = await db.payment.create({
    data: { userId: student.userId, printJobId, provider: "OPAY", status: "FAILED", amount: 1_200, currency: "NGN", transactionReference: `packam_${randomUUID()}`, idempotencyKey: randomUUID() },
    select: { id: true },
  });
  await assert.rejects(db.payment.update({ where: { id: retry.id }, data: { status: "SUCCESS" } }), unique);
  assert.equal(await db.payment.count({ where: { printJobId, status: "SUCCESS" } }), 1);
});

test("a late OPay success for the job's only payment finalises it once", { skip }, async () => {
  const { db, service, payments } = app;
  const student = await createTestUser("STUDENT");
  const { printJobId } = await preparedPrintJob(student);
  const attempt = await service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, randomUUID());
  assert.equal(await payments.failPendingPayment(attempt.transactionReference!), true);

  const verified = trustedTestVerifiedPayment(attempt);
  const result = await payments.completeVerifiedPayment(verified);
  assert.equal(result.alreadyProcessed, false);
  assert.deepEqual(await payments.completeVerifiedPayment(verified), { orderId: null, printJobId, alreadyProcessed: true }, "repeat callbacks are idempotent");
  const payment = await db.payment.findUniqueOrThrow({ where: { id: attempt.id }, select: { status: true, providerReference: true } });
  assert.deepEqual(payment, { status: "SUCCESS", providerReference: verified.providerReference });
  assert.equal((await db.printJob.findUniqueOrThrow({ where: { id: printJobId }, select: { status: true } })).status, "FINDING_RUNNER");
  assert.equal(await db.printJobStatusHistory.count({ where: { printJobId, status: "FINDING_RUNNER" } }), 1);
});

test("a late OPay success for an already-paid print job is recorded and alerted once, without a second fulfilment", { skip }, async () => {
  const { db, service, payments } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const { printJobId } = await preparedPrintJob(student);

  // First attempt fails, the student pays again successfully, then OPay confirms the first one too.
  const first = await service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, randomUUID());
  await payments.failPendingPayment(first.transactionReference!);
  const second = await service.createPrintPaymentAttempt("OPAY", student.userId, printJobId, randomUUID());
  assert.notEqual(second.id, first.id);
  await payments.completeVerifiedPayment(trustedTestVerifiedPayment(second));

  const late = trustedTestVerifiedPayment(first);
  await assert.rejects(payments.completeVerifiedPayment(late), (error: unknown) => error instanceof Error && error.name === "PrintPaymentNeedsReviewError");
  const firstCapture = (await db.payment.findUniqueOrThrow({ where: { id: first.id }, select: { paidAt: true } })).paidAt;
  assert.ok(firstCapture, "the capture time is recorded on the first callback");
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (let callback = 0; callback < 3; callback += 1) {
    await assert.rejects(payments.completeVerifiedPayment(late), (error: unknown) => error instanceof Error && error.name === "PrintPaymentNeedsReviewError", `callback ${callback}`);
  }
  // Concurrent duplicate callbacks behave the same way.
  const concurrent = await Promise.allSettled([payments.completeVerifiedPayment(late), payments.completeVerifiedPayment(late)]);
  assert.ok(concurrent.every((r) => r.status === "rejected" && (r.reason as Error).name === "PrintPaymentNeedsReviewError"));

  const rows = await db.payment.findMany({ where: { printJobId }, select: { id: true, status: true, providerReference: true, paidAt: true } });
  const recorded = rows.find((r) => r.id === first.id)!;
  assert.equal(recorded.status, "RECONCILIATION_REQUIRED", "the provider's success is kept for operations, never SUCCESS");
  assert.equal(recorded.providerReference, late.providerReference);
  assert.equal(recorded.paidAt?.getTime(), firstCapture.getTime(), "repeated callbacks keep the first capture time");
  assert.equal(rows.filter((r) => r.status === "SUCCESS").length, 1, "only one successful payment");
  assert.equal(await db.refund.count({ where: { order: { userId: student.userId } } }), 0, "no refund is invented");

  const job = await db.printJob.findUniqueOrThrow({ where: { id: printJobId }, select: { status: true } });
  assert.equal(job.status, "FINDING_RUNNER");
  assert.equal(await db.printJobStatusHistory.count({ where: { printJobId, status: "FINDING_RUNNER" } }), 1, "fulfilment started once");
  assert.equal(await db.notification.count({ where: { userId: admin.userId, relatedId: printJobId, title: "Possible double payment for a print job" } }), 1, "operations alerted exactly once");
  const studentNotice = await db.notification.findMany({ where: { userId: student.userId, relatedId: printJobId, title: "We received an extra payment" }, select: { message: true } });
  assert.equal(studentNotice.length, 1, "student told exactly once");
  assert.doesNotMatch(studentNotice[0].message, /refunded|has been refunded/i, "no refund is claimed");
});
