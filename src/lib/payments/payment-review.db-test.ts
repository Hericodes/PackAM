/**
 * Admin payment review against a disposable database: real review service, route, lifecycle and
 * audit trail. Nothing calls OPay — provider behaviour (timeouts, pending, failure, success) is an
 * injected status query, and successes carry the harness's TEST-NO-MONEY provider reference.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
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
import type { VerificationDeps } from "./opay-verification";
import type { OpayTransaction } from "./providers/opay-money";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  cart: typeof import("../../app/api/cart/route");
  route: typeof import("../../app/api/admin/payments/[id]/route");
  payments: typeof import("./payment-lifecycle");
  review: typeof import("./payment-review");
  store: typeof import("./checkout-cancellation-store");
  errors: typeof import("./payment-errors");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [cart, route, payments, review, store, errors] = await Promise.all([
    import("../../app/api/cart/route"),
    import("../../app/api/admin/payments/[id]/route"),
    import("./payment-lifecycle"),
    import("./payment-review"),
    import("./checkout-cancellation-store"),
    import("./payment-errors"),
  ]);
  app = { db, cart, route, payments, review, store, errors };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;

async function pendingCheckout(student: User) {
  const { products } = await createTestCatalogue([{ name: "Review item", price: 800 }]);
  signInAs(student);
  assert.equal((await callRoute(app.cart.POST, { method: "POST", body: { productId: products[0].id, quantity: 1 } })).status, 200);
  const location = await createTestLocation(student.userId);
  signInAs(student);
  return app.payments.createPaymentAttempt("OPAY", location.id, randomUUID());
}

/** Provider stand-in: same lifecycle functions as production, injected status query. */
function provider(answer: (attempt: { transactionReference: string | null; amount: number }) => OpayTransaction | Promise<OpayTransaction>, attempt: { transactionReference: string | null; amount: number }, counter?: { queries: number }): VerificationDeps {
  return { ...app.store.opayStatusDeps, queryStatus: async () => { if (counter) counter.queries++; return answer(attempt); } };
}
const opayRecord = (status: string) => (attempt: { transactionReference: string | null; amount: number }): OpayTransaction => ({ reference: attempt.transactionReference!, transactionId: `TEST-NO-MONEY-${randomUUID()}`, status, amount: { total: attempt.amount * 100, currency: "NGN" } });

function act(user: User | null, paymentId: string, body: Record<string, unknown>) {
  signInAs(user);
  return callRoute(app.route.POST, { method: "POST", params: { id: paymentId }, body });
}

const paymentStatus = async (id: string) => (await app.db.payment.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

test("only admins can act on payment reviews", { skip }, async () => {
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  const attempt = await pendingCheckout(student);
  for (const user of [null, student, runner]) {
    assert.equal((await act(user, attempt.id, { action: "close", note: "Trying to close someone's case" })).status, 403);
  }
  assert.equal(await app.db.paymentReviewCase.count({ where: { paymentId: attempt.id } }), 0);
});

test("OPay timeout: the payment stays unresolved, each attempt is recorded, and checks never overlap", { skip }, async () => {
  const { db, review, errors } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const attempt = await pendingCheckout(student);
  await app.payments.markPaymentNeedsReview(attempt.transactionReference!, "test mismatch");
  const counter = { queries: 0 };
  const timeout = provider(() => { throw new errors.OpayProviderUnavailableError("OPay request timed out."); }, attempt, counter);

  const first = await review.retryPaymentVerification(admin.userId, attempt.id, timeout);
  assert.equal(first.status, 200);
  assert.equal(first.body.outcome, "PROVIDER_UNAVAILABLE");
  assert.equal(await paymentStatus(attempt.id), "RECONCILIATION_REQUIRED", "a timeout is not evidence of failure");
  await review.retryPaymentVerification(admin.userId, attempt.id, timeout);
  const reviewCase = await db.paymentReviewCase.findUniqueOrThrow({ where: { paymentId: attempt.id } });
  assert.equal(reviewCase.checkCount, 2);
  assert.equal(reviewCase.lastCheckOutcome, "PROVIDER_UNAVAILABLE");
  assert.equal(reviewCase.checkLockedUntil, null, "the lock is released after each check");
  assert.equal(await db.auditLog.count({ where: { action: "PAYMENT_VERIFICATION_RETRIED", resourceId: attempt.id, actorId: admin.userId } }), 2);

  // Overlapping clicks: the second request is refused while the first is still talking to OPay.
  const slow = provider(async (a) => { await new Promise((resolve) => setTimeout(resolve, 150)); return opayRecord("PENDING")(a); }, attempt, counter);
  const before = counter.queries;
  const results = await Promise.all([review.retryPaymentVerification(admin.userId, attempt.id, slow), review.retryPaymentVerification(admin.userId, attempt.id, slow)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(counter.queries - before, 1, "only one status query ran");

  // Cancelling is refused while the payment is under review and OPay can't confirm anything.
  const cancel = await review.cancelLinkedUnpaid(admin.userId, attempt.id, timeout);
  assert.equal(cancel.status, 409);
  assert.equal(await paymentStatus(attempt.id), "RECONCILIATION_REQUIRED");
});

test("pending payment with OPay unreachable can't be cancelled; after OPay confirms failure it can", { skip }, async () => {
  const { db, review, errors } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const attempt = await pendingCheckout(student);
  const cartBefore = await db.cartItem.count({ where: { cart: { userId: student.userId } } });

  const blocked = await review.cancelLinkedUnpaid(admin.userId, attempt.id, provider(() => { throw new errors.OpayProviderUnavailableError("down"); }, attempt));
  assert.equal(blocked.status, 409);
  assert.match(String(blocked.body.error), /could discard a real payment/);
  assert.equal(await paymentStatus(attempt.id), "PENDING");

  const cancelled = await review.cancelLinkedUnpaid(admin.userId, attempt.id, provider(opayRecord("CLOSE"), attempt));
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(await paymentStatus(attempt.id), "FAILED");
  assert.equal(await db.auditLog.count({ where: { action: "checkout.cancelled_by_student", resourceId: attempt.id, actorId: admin.userId } }), 1, "recorded with the admin as actor");
  assert.equal(await db.cartItem.count({ where: { cart: { userId: student.userId } } }), cartBefore, "an admin cancel leaves the student's cart alone");
  assert.equal((await review.cancelLinkedUnpaid(admin.userId, attempt.id)).body.alreadyCancelled, true, "repeat cancel is idempotent");

  // A late success after the cancel never creates an order.
  await assert.rejects(app.payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt)), /no longer pending/i);
  assert.equal(await db.order.count({ where: { userId: student.userId } }), 0);
});

test("under review: a verified OPay failure ends the hold only when no money was captured", { skip }, async () => {
  const { db, review } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");

  const uncaptured = await pendingCheckout(student);
  await app.payments.markPaymentNeedsReview(uncaptured.transactionReference!, "test mismatch");
  const result = await review.retryPaymentVerification(admin.userId, uncaptured.id, provider(opayRecord("FAIL"), uncaptured));
  assert.equal(result.body.outcome, "CONFIRMED_FAILED");
  assert.equal(await paymentStatus(uncaptured.id), "FAILED");
  assert.equal(await db.auditLog.count({ where: { action: "PAYMENT_REVIEW_VERIFIED_FAILED", resourceId: uncaptured.id, actorId: admin.userId } }), 1);

  // Money already confirmed once (provider transaction + paid time): never moved to FAILED.
  const captured = await pendingCheckout(student);
  await db.payment.update({ where: { id: captured.id }, data: { status: "RECONCILIATION_REQUIRED", providerReference: `TEST-NO-MONEY-${randomUUID()}`, paidAt: new Date() } });
  const held = await review.retryPaymentVerification(admin.userId, captured.id, provider(opayRecord("FAIL"), captured));
  assert.equal(held.status, 200);
  assert.equal(await paymentStatus(captured.id), "RECONCILIATION_REQUIRED");
});

test("provider-confirmed success finalises once; a paid payment has nothing left to verify or cancel", { skip }, async () => {
  const { db, review } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const attempt = await pendingCheckout(student);
  const paid = await review.retryPaymentVerification(admin.userId, attempt.id, provider(opayRecord("SUCCESS"), attempt));
  assert.equal(paid.body.outcome, "CONFIRMED_SUCCESS");
  assert.equal(await paymentStatus(attempt.id), "SUCCESS");
  assert.equal(await db.order.count({ where: { userId: student.userId } }), 1);
  assert.equal((await review.retryPaymentVerification(admin.userId, attempt.id)).status, 409, "nothing for OPay to confirm");
  assert.equal((await review.cancelLinkedUnpaid(admin.userId, attempt.id)).status, 409);
  assert.equal(await db.order.count({ where: { userId: student.userId } }), 1);
});

test("closing needs a note, never changes the payment, is audited, and can be reopened", { skip }, async () => {
  const { db } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const attempt = await pendingCheckout(student);
  await app.payments.markPaymentNeedsReview(attempt.transactionReference!, "test mismatch");

  assert.equal((await act(admin, attempt.id, { action: "close" })).status, 400);
  assert.equal((await act(admin, attempt.id, { action: "close", note: "short" })).status, 400);
  const closes = await Promise.all([1, 2].map(() => act(admin, attempt.id, { action: "close", note: "OPay support confirmed they are investigating; parked." })));
  assert.deepEqual(closes.map((r) => r.status).sort(), [200, 409], "a repeated close is refused, not duplicated");
  assert.equal(await paymentStatus(attempt.id), "RECONCILIATION_REQUIRED", "closing a case is not a statement about money");
  const closed = await db.paymentReviewCase.findUniqueOrThrow({ where: { paymentId: attempt.id } });
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.closedById, admin.userId);
  const audit = await db.auditLog.findMany({ where: { action: "PAYMENT_REVIEW_CLOSED", resourceId: attempt.id }, select: { actorId: true, details: true, previousState: true } });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actorId, admin.userId);
  assert.match(audit[0].details ?? "", /OPay support/);
  assert.match(JSON.stringify(audit[0].previousState), /RECONCILIATION_REQUIRED/);

  assert.equal((await act(admin, attempt.id, { action: "escalate", note: "Should not escalate a closed case" })).status, 409);
  assert.equal((await act(admin, attempt.id, { action: "reopen" })).status, 400, "reopening needs a reason too");
  assert.equal((await act(admin, attempt.id, { action: "reopen", note: "Student emailed proof of debit." })).status, 200);
  assert.equal((await act(admin, attempt.id, { action: "reopen", note: "Student emailed proof of debit." })).status, 409);
  assert.equal((await db.paymentReviewCase.findUniqueOrThrow({ where: { paymentId: attempt.id } })).status, "OPEN");
  assert.equal(await db.auditLog.count({ where: { action: "PAYMENT_REVIEW_REOPENED", resourceId: attempt.id, actorId: admin.userId } }), 1);

  const escalated = await act(admin, attempt.id, { action: "escalate", note: "OPay status endpoint down for 6 hours; needs follow-up." });
  assert.equal(escalated.status, 200);
  assert.equal(await db.notification.count({ where: { userId: admin.userId, title: "Payment review escalated" } }), 1);
  assert.equal(await paymentStatus(attempt.id), "RECONCILIATION_REQUIRED");
});
