/**
 * Cancelling an unpaid marketplace checkout against a disposable database: real routes, real
 * serializable transactions, real payment lifecycle. Nothing calls OPay: failed attempts are failed
 * through failPendingPayment, and pending reconciliation uses an injected provider record.
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

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  cart: typeof import("../../app/api/cart/route");
  cancel: typeof import("../../app/api/payments/opay/cancel/route");
  status: typeof import("../../app/api/payments/opay/status/route");
  payments: typeof import("./payment-lifecycle");
  store: typeof import("./checkout-cancellation-store");
  rules: typeof import("./checkout-cancellation");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [cart, cancel, status, payments, store, rules] = await Promise.all([
    import("../../app/api/cart/route"),
    import("../../app/api/payments/opay/cancel/route"),
    import("../../app/api/payments/opay/status/route"),
    import("./payment-lifecycle"),
    import("./checkout-cancellation-store"),
    import("./checkout-cancellation"),
  ]);
  app = { db, cart, cancel, status, payments, store, rules };
});
after(cleanupTestData);

type Student = Awaited<ReturnType<typeof createTestUser>>;

async function checkout(student: Student, items: Array<{ productId: string; quantity: number }>) {
  signInAs(student);
  for (const item of items) {
    const added = await callRoute(app.cart.POST, { method: "POST", path: "/api/cart", body: item });
    assert.equal(added.status, 200, JSON.stringify(added.json));
  }
  const location = await createTestLocation(student.userId);
  signInAs(student);
  return app.payments.createPaymentAttempt("OPAY", location.id, randomUUID());
}

function cancelAs(student: Student | null, reference: string) {
  signInAs(student);
  return callRoute(app.cancel.POST, { method: "POST", path: "/api/payments/opay/cancel", body: { reference } });
}

async function cartQuantities(userId: string) {
  const items = await app.db.cartItem.findMany({ where: { cart: { userId } }, select: { productId: true, quantity: true } });
  return Object.fromEntries(items.map((item) => [item.productId, item.quantity]));
}

/** Provider stand-in for reconciliation: same lifecycle functions, injected OPay record. */
function verificationReturning(status: string, attempt: { transactionReference: string | null; amount: number }): VerificationDeps {
  return {
    ...app.store.opayStatusDeps,
    queryStatus: async () => ({
      reference: attempt.transactionReference!,
      transactionId: `TEST-NO-MONEY-${randomUUID()}`,
      status,
      amount: { total: attempt.amount * 100, currency: "NGN" },
    }),
  };
}

test("failed payment: Cancel Order removes only the captured items, once, even with repeated clicks", { skip }, async () => {
  const { db } = app;
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Gala", price: 300 }, { name: "Biro", price: 100 }]);
  const [gala, biro] = products;
  const attempt = await checkout(student, [{ productId: gala.id, quantity: 2 }, { productId: biro.id, quantity: 1 }]);
  // The student adds more after starting payment; those later additions must survive cancellation.
  signInAs(student);
  assert.equal((await callRoute(app.cart.POST, { method: "POST", body: { productId: gala.id, quantity: 1 } })).status, 200);
  assert.equal(await app.payments.failPendingPayment(attempt.transactionReference!), true);

  signInAs(student);
  const failed = await callRoute(app.status.GET, { path: `/api/payments/opay/status?reference=${attempt.transactionReference}` });
  assert.deepEqual(failed.json, { status: "FAILED", cancelled: false, provider: "OPAY" });

  const results = await Promise.all([1, 2, 3].map(() => cancelAs(student, attempt.transactionReference!)));
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(results.filter((r) => r.json.alreadyCancelled === false).length, 1, "exactly one request performs the cancellation");

  assert.deepEqual(await cartQuantities(student.userId), { [gala.id]: 1 }, "captured quantities removed, later addition kept");
  assert.equal(await db.auditLog.count({ where: { action: "checkout.cancelled_by_student", resourceId: attempt.id } }), 1);
  assert.equal(await db.notification.count({ where: { userId: student.userId, idempotencyKey: `checkout-cancelled:${attempt.id}` } }), 1);
  const payment = await db.payment.findUniqueOrThrow({ where: { id: attempt.id }, select: { status: true, orderId: true } });
  assert.deepEqual(payment, { status: "FAILED", orderId: null });
  assert.equal(await db.order.count({ where: { userId: student.userId } }), 0);

  signInAs(student);
  const after = await callRoute(app.status.GET, { path: `/api/payments/opay/status?reference=${attempt.transactionReference}` });
  assert.deepEqual(after.json, { status: "FAILED", cancelled: true, provider: "OPAY" });
});

test("late provider success after cancellation never creates an order and alerts operations", { skip }, async () => {
  const { db } = app;
  const student = await createTestUser("STUDENT");
  const admin = await createTestUser("ADMIN");
  const { products } = await createTestCatalogue([{ name: "Plantain chips", price: 500 }]);
  const attempt = await checkout(student, [{ productId: products[0].id, quantity: 1 }]);
  await app.payments.failPendingPayment(attempt.transactionReference!);
  assert.equal((await cancelAs(student, attempt.transactionReference!)).status, 200);

  const late = trustedTestVerifiedPayment(attempt);
  await assert.rejects(app.payments.completeVerifiedPayment(late), /no longer pending/i);
  await assert.rejects(app.payments.completeVerifiedPayment(late), /no longer pending/i, "a duplicate late callback is refused too");
  assert.equal(await db.order.count({ where: { userId: student.userId } }), 0);
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: attempt.id } })).status, "FAILED");
  assert.equal(await db.notification.count({ where: { userId: admin.userId, idempotencyKey: `payment-late-success:${attempt.transactionReference}` } }), 1);
  assert.equal((await cancelAs(student, attempt.transactionReference!)).json.alreadyCancelled, true);
});

test("pending payment: cancelled only after OPay verifies it closed; never failed while uncertain", { skip }, async () => {
  const { db, rules, store } = app;
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Sachet water", price: 50 }]);
  const attempt = await checkout(student, [{ productId: products[0].id, quantity: 4 }]);
  const reference = attempt.transactionReference!;

  const stillPending = await rules.cancelUnpaidCheckout(store.checkoutCancellationDeps(reference, student.userId, verificationReturning("PENDING", attempt)));
  assert.deepEqual(stillPending, { kind: "STILL_PENDING" });
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: attempt.id } })).status, "PENDING");
  assert.deepEqual(await cartQuantities(student.userId), { [products[0].id]: 4 });

  const closed = await rules.cancelUnpaidCheckout(store.checkoutCancellationDeps(reference, student.userId, verificationReturning("CLOSE", attempt)));
  assert.deepEqual(closed, { kind: "CANCELLED", alreadyCancelled: false });
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: attempt.id } })).status, "FAILED");
  assert.deepEqual(await cartQuantities(student.userId), {});
});

test("pending payment that OPay reports as paid becomes an order and is not cancelled", { skip }, async () => {
  const { db, rules, store } = app;
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Exercise book", price: 250 }]);
  const attempt = await checkout(student, [{ productId: products[0].id, quantity: 2 }]);

  const result = await rules.cancelUnpaidCheckout(store.checkoutCancellationDeps(attempt.transactionReference!, student.userId, verificationReturning("SUCCESS", attempt)));
  assert.equal(result.kind, "PAID");
  const order = await db.order.findFirstOrThrow({ where: { userId: student.userId }, select: { id: true, status: true } });
  assert.equal(result.kind === "PAID" && result.orderId, order.id);
  assert.equal(await db.auditLog.count({ where: { action: "checkout.cancelled_by_student", resourceId: attempt.id } }), 0);

  // Afterwards the route refuses an unpaid-order cancellation for the paid order.
  const refused = await cancelAs(student, attempt.transactionReference!);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.status, "SUCCESS");
  assert.doesNotMatch(JSON.stringify(refused.json), /refund/i);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, order.status);
});

test("cancellation is refused for other users and for a failed attempt superseded by a newer checkout", { skip }, async () => {
  const { db } = app;
  const student = await createTestUser("STUDENT");
  const other = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  const { products } = await createTestCatalogue([{ name: "Charger", price: 4_000 }]);
  const first = await checkout(student, [{ productId: products[0].id, quantity: 1 }]);
  await app.payments.failPendingPayment(first.transactionReference!);

  assert.equal((await cancelAs(null, first.transactionReference!)).status, 401);
  assert.equal((await cancelAs(runner, first.transactionReference!)).status, 403);
  assert.equal((await cancelAs(other, first.transactionReference!)).status, 404);
  assert.equal((await cancelAs(student, "")).status, 400);
  assert.equal(await db.auditLog.count({ where: { action: "checkout.cancelled_by_student", resourceId: first.id } }), 0);

  // Try Again starts a new attempt for the same cart; the old one can no longer remove those items.
  const location = await createTestLocation(student.userId);
  signInAs(student);
  await app.payments.createPaymentAttempt("OPAY", location.id, randomUUID());
  const superseded = await cancelAs(student, first.transactionReference!);
  assert.equal(superseded.status, 409);
  assert.equal(superseded.json.status, "SUPERSEDED");
  assert.deepEqual(await cartQuantities(student.userId), { [products[0].id]: 1 });
});
