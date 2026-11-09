/**
 * Promo codes against a disposable database: an admin creates and pauses codes; a student applies one at checkout,
 * pays the discounted amount, and the order keeps the full items subtotal and delivery fee with total = what was paid.
 * Uses count only once a payment succeeds, per student and in total.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  dbTestSkip as skip,
  runTag,
  signInAs,
  testDb,
  trustedTestVerifiedPayment,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  cart: typeof import("../../app/api/cart/route");
  adminCodes: typeof import("../../app/api/admin/promo-codes/route");
  adminCode: typeof import("../../app/api/admin/promo-codes/[id]/route");
  check: typeof import("../../app/api/promo-codes/check/route");
  paymentCreate: typeof import("../../app/api/payments/create/route");
  payments: typeof import("../payments/payment-lifecycle");
  errors: typeof import("../payments/payment-errors");
  rules: typeof import("./promo-rules");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [cart, adminCodes, adminCode, check, paymentCreate, payments, errors, rules] = await Promise.all([
    import("../../app/api/cart/route"),
    import("../../app/api/admin/promo-codes/route"),
    import("../../app/api/admin/promo-codes/[id]/route"),
    import("../../app/api/promo-codes/check/route"),
    import("../../app/api/payments/create/route"),
    import("../payments/payment-lifecycle"),
    import("../payments/payment-errors"),
    import("./promo-rules"),
  ]);
  app = { db, cart, adminCodes, adminCode, check, paymentCreate, payments, errors, rules };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;
const tag = runTag.toUpperCase().replace(/[^A-Z0-9]/g, "");
const uniqueCode = (prefix: string) => `${prefix}${tag}${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 20);

async function createCode(admin: User, body: Record<string, unknown>) {
  signInAs(admin);
  return callRoute(app.adminCodes.POST, { method: "POST", path: "/api/admin/promo-codes", body, headers: { Origin: "http://packam.test" } });
}

async function studentWithItems(price: number) {
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Promo test item", price }]);
  signInAs(student);
  const added = await callRoute(app.cart.POST, { method: "POST", body: { productId: products[0].id, quantity: 1 } });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  const location = await createTestLocation(student.userId);
  return { student, location };
}

function checkCode(student: User, code: string) {
  signInAs(student);
  return callRoute(app.check.POST, { method: "POST", path: "/api/promo-codes/check", body: { code } });
}

async function payWithCode(student: User, locationId: string, code: string | null, key = randomUUID()) {
  signInAs(student);
  return app.payments.createPaymentAttempt("OPAY", locationId, key, null, undefined, {}, { code });
}

test("an admin creates a code; the same code twice is refused; students can't create codes", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const code = uniqueCode("NEW");
  const created = await createCode(admin, { code: code.toLowerCase(), type: "FIXED", value: "1000" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const row = await app.db.promoCode.findUniqueOrThrow({ where: { code }, select: { type: true, value: true, maxUsesPerStudent: true, active: true, createdById: true } });
  assert.deepEqual(row, { type: "FIXED", value: 1_000, maxUsesPerStudent: 1, active: true, createdById: admin.userId });
  assert.equal(await app.db.auditLog.count({ where: { action: "PROMO_CODE_CREATED", actorId: admin.userId } }), 1);

  assert.equal((await createCode(admin, { code, type: "PERCENT", value: 10 })).json.code, "PROMO_CODE_TAKEN");
  assert.equal((await createCode(admin, { code: uniqueCode("BAD"), type: "PERCENT", value: 150 })).status, 400);

  const student = await createTestUser("STUDENT");
  assert.equal((await createCode(student, { code: uniqueCode("NOPE"), type: "FIXED", value: 500 })).status, 403);
});

test("a student applies ₦1,000 off, pays items + delivery − ₦1,000, and the order records it", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const code = uniqueCode("OFF");
  assert.equal((await createCode(admin, { code, type: "FIXED", value: 1000 })).status, 201);
  const { student, location } = await studentWithItems(5_000);

  const checked = await checkCode(student, ` ${code.toLowerCase()} `);
  assert.equal(checked.status, 200, JSON.stringify(checked.json));
  assert.deepEqual(checked.json.promo, { code, label: "₦1,000 off your items", discount: 1_000, rule: { type: "FIXED", value: 1_000, maxDiscount: null, minSubtotal: 0 } });

  const attempt = await payWithCode(student, location.id, code);
  const payment = await app.db.payment.findUniqueOrThrow({ where: { id: attempt.id }, select: { amount: true, checkoutSnapshot: true } });
  const snapshot = payment.checkoutSnapshot as { subtotal: number; deliveryFee: number; promo: { code: string; discount: number } };
  assert.equal(snapshot.subtotal, 5_000);
  assert.equal(snapshot.promo.code, code);
  assert.equal(snapshot.promo.discount, 1_000);
  assert.equal(payment.amount, 5_000 + snapshot.deliveryFee - 1_000, "delivery is paid in full");
  assert.equal(await app.db.promoRedemption.count({ where: { paymentId: attempt.id, discount: 1_000 } }), 1, "the use is recorded with the attempt");

  const { orderId } = await app.payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));
  const order = await app.db.order.findUniqueOrThrow({ where: { id: orderId! }, select: { subtotal: true, deliveryFee: true, total: true } });
  assert.deepEqual(order, { subtotal: 5_000, deliveryFee: snapshot.deliveryFee, total: 5_000 + snapshot.deliveryFee - 1_000 });

  // One use per student: a second order is refused, at Apply and at payment.
  signInAs(student);
  const { products } = await createTestCatalogue([{ name: "Second promo item", price: 2_000 }]);
  assert.equal((await callRoute(app.cart.POST, { method: "POST", body: { productId: products[0].id, quantity: 1 } })).status, 200);
  const again = await checkCode(student, code);
  assert.equal(again.status, 409);
  assert.equal(again.json.reason, "ALREADY_USED");
  await assert.rejects(payWithCode(student, location.id, code), (error: Error) => error instanceof app.rules.PromoCodeRejectedError && error.reason === "ALREADY_USED");
});

test("a code never takes off more than the items: ₦2k on ₦1,500 of items leaves delivery to pay", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const code = uniqueCode("BIG");
  assert.equal((await createCode(admin, { code, type: "FIXED", value: 2000 })).status, 201);
  const { student, location } = await studentWithItems(1_500);
  const attempt = await payWithCode(student, location.id, code);
  const payment = await app.db.payment.findUniqueOrThrow({ where: { id: attempt.id }, select: { amount: true, checkoutSnapshot: true } });
  const snapshot = payment.checkoutSnapshot as { deliveryFee: number; promo: { discount: number } };
  assert.equal(snapshot.promo.discount, 1_500);
  assert.equal(payment.amount, snapshot.deliveryFee);
  assert.ok(payment.amount > 0, "never a ₦0 payment");
});

test("only paid checkouts count as uses; a code used up in total is refused", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const code = uniqueCode("ONE");
  assert.equal((await createCode(admin, { code, type: "PERCENT", value: 10, maxUses: 1 })).status, 201);
  const first = await studentWithItems(3_000);
  const second = await studentWithItems(3_000);

  const pending = await payWithCode(first.student, first.location.id, code);
  assert.equal((await checkCode(second.student, code)).status, 200, "an unpaid attempt doesn't use the code up");

  await app.payments.completeVerifiedPayment(trustedTestVerifiedPayment(pending));
  const usedUp = await checkCode(second.student, code);
  assert.equal(usedUp.status, 409);
  assert.equal(usedUp.json.reason, "USED_UP");
});

test("a paused code is refused; resuming brings it back", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const code = uniqueCode("PAUSE");
  const created = await createCode(admin, { code, type: "FIXED", value: 500 });
  const id = (created.json.promoCode as { id: string }).id;
  const { student } = await studentWithItems(2_000);

  signInAs(admin);
  assert.equal((await callRoute(app.adminCode.PATCH, { method: "PATCH", params: { id }, body: { active: false }, headers: { Origin: "http://packam.test" } })).status, 200);
  assert.equal((await checkCode(student, code)).json.reason, "PAUSED");
  signInAs(admin);
  assert.equal((await callRoute(app.adminCode.PATCH, { method: "PATCH", params: { id }, body: { active: true }, headers: { Origin: "http://packam.test" } })).status, 200);
  assert.equal((await checkCode(student, code)).status, 200);
  assert.equal(await app.db.auditLog.count({ where: { resourceId: id, action: { in: ["PROMO_CODE_PAUSED", "PROMO_CODE_RESUMED"] } } }), 2);
});

test("payment re-checks the code and the reviewed total; one key never covers two different codes", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const code = uniqueCode("KEY");
  assert.equal((await createCode(admin, { code, type: "FIXED", value: 300 })).status, 201);
  const { student, location } = await studentWithItems(2_000);

  // The student reviewed the total without the discount: shown the new breakdown with the promo line, nothing created.
  signInAs(student);
  await assert.rejects(app.payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 99_999, {}, { code }), (error: Error) => {
    assert.ok(error instanceof app.errors.PriceChangedError);
    assert.equal(error.revised.discount, 300);
    assert.equal(error.revised.promoCode, code);
    return true;
  });

  const key = randomUUID();
  const withCode = await payWithCode(student, location.id, code, key);
  assert.equal((await payWithCode(student, location.id, code, key)).id, withCode.id, "same key and code: the same attempt");
  await assert.rejects(payWithCode(student, location.id, null, key), app.errors.CheckoutAttemptMismatchError, "same key without the code is refused");

  // Through the route: an unknown code is refused with the reason and nothing is created.
  signInAs(student);
  const refused = await callRoute(app.paymentCreate.POST, { method: "POST", path: "/api/payments/create", headers: { "Idempotency-Key": randomUUID() }, body: { deliveryLocationId: location.id, reviewedTotal: 0, promoCode: "NOSUCHCODE1" } });
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(refused.json.code, "PROMO_REJECTED");
  assert.match(String(refused.json.error), /don’t know that promo code.*Nothing has been charged/);
});
