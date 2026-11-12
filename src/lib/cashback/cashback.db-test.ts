/**
 * Cashback against a disposable database (bank transfer only, no network):
 * - a delivered order earns the % back on what was paid for the items, once; the welcome bonus comes once, ever;
 * - checkout uses the balance on the items (never delivery), and it comes back by itself if the payment fails;
 * - an admin can add or take away cashback, never below ₦0.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  asUser,
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  dbTestSkip,
  testDb,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

let skip: string | false = dbTestSkip;
type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  store: typeof import("./cashback-store");
  admin: typeof import("./cashback-admin");
  transition: typeof import("../orders/transition");
  cart: typeof import("../../app/api/cart/route");
  create: typeof import("../../app/api/payments/create/route");
};
let app: App;
let savedSettings: { enabled: boolean; ratePercent: number; welcomeBonus: number } | null = null;

const ACCOUNT = { MANUAL_TRANSFER_BANK_NAME: "OPay", MANUAL_TRANSFER_ACCOUNT_NUMBER: "6148466206", MANUAL_TRANSFER_ACCOUNT_NAME: "AvenzLAB" };
const ENV_KEYS = ["PAYMENT_PROVIDER", "APP_URL", ...Object.keys(ACCOUNT)] as const;
const savedEnv: Record<string, string | undefined> = {};

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [store, admin, transition, cart, create] = await Promise.all([
    import("./cashback-store"),
    import("./cashback-admin"),
    import("../orders/transition"),
    import("../../app/api/cart/route"),
    import("../../app/api/payments/create/route"),
  ]);
  app = { db, store, admin, transition, cart, create };
  if (!(await store.cashbackTablesReady(db))) { skip = "cashback migration not applied to this test database"; return; }
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  Object.assign(process.env, ACCOUNT, { PAYMENT_PROVIDER: "MANUAL", APP_URL: "https://packam.example" });
  savedSettings = await db.cashbackSettings.findUnique({ where: { id: "default" }, select: { enabled: true, ratePercent: true, welcomeBonus: true } });
  await db.cashbackSettings.upsert({ where: { id: "default" }, create: { id: "default", enabled: true, ratePercent: 2, welcomeBonus: 500 }, update: { enabled: true, ratePercent: 2, welcomeBonus: 500 } });
});
after(async () => {
  if (!skip && savedSettings) await app.db.cashbackSettings.update({ where: { id: "default" }, data: savedSettings });
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await cleanupTestData();
});

async function deliveredOrder(userId: string, subtotal: number, deliveryFee: number) {
  const order = await app.db.order.create({ data: { userId, status: "OUT_FOR_DELIVERY", subtotal, deliveryFee, total: subtotal + deliveryFee, deliveryAddress: "Room 1, Test Hall, OOU" }, select: { id: true } });
  await app.db.$transaction((tx) => app.transition.transitionOrderInTransaction(tx, { orderId: order.id, toStatus: "DELIVERED", note: "Delivered in test." }));
  return order.id;
}

test("a delivered order earns 2% back on the items once, and the welcome bonus comes once ever", async (t) => {
  if (skip) return t.skip(skip);
  const student = await createTestUser("STUDENT");
  const first = await deliveredOrder(student.userId, 2_500, 200);
  assert.equal(await app.store.cashbackBalance(app.db, student.userId), 50 + 500, "2% of ₦2,500 plus the ₦500 welcome bonus");
  await deliveredOrder(student.userId, 1_000, 200);
  assert.equal(await app.store.cashbackBalance(app.db, student.userId), 50 + 500 + 20, "no second welcome bonus");
  assert.equal(await app.db.cashbackEntry.count({ where: { orderId: first, kind: "EARNED" } }), 1);
});

test("checkout uses the balance on the items only, and it comes back if the payment fails", async (t) => {
  if (skip) return t.skip(skip);
  const student = await createTestUser("STUDENT");
  await app.db.cashbackEntry.create({ data: { userId: student.userId, kind: "ADJUSTMENT", amount: 300, key: `adjust:${randomUUID()}`, actorId: student.userId, note: "Test credit" } });
  const { products } = await createTestCatalogue([{ name: "Cashback rice", price: 1_500 }]);
  assert.equal((await asUser(student, () => callRoute(app.cart.POST, { method: "POST", path: "/api/cart", body: { productId: products[0].id, quantity: 1 } }))).status, 200);
  const location = await createTestLocation(student.userId);

  const body = { cart: "stuff", deliveryLocationId: location.id, deliveryTier: "CRUISE", reviewedDeliveryFee: 200, reviewedTotal: 1_500 + 200 - 300, useCashback: true };
  const response = await asUser(student, () => callRoute(app.create.POST, { method: "POST", path: "/api/payments/create", headers: { "Idempotency-Key": randomUUID() }, body }));
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const payment = await app.db.payment.findFirstOrThrow({ where: { userId: student.userId }, orderBy: { createdAt: "desc" }, select: { id: true, amount: true, checkoutSnapshot: true } });
  assert.equal(payment.amount, 1_400, "₦300 cashback off the items; delivery paid in full");
  assert.deepEqual((payment.checkoutSnapshot as { cashback?: unknown }).cashback, { amount: 300 });
  assert.equal(await app.store.cashbackBalance(app.db, student.userId), 0, "held while the payment is open");

  await app.db.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failedAt: new Date() } });
  assert.equal(await app.store.cashbackBalance(app.db, student.userId), 300, "back once the payment failed");
});

test("admins add or take away cashback with a reason, never below ₦0", async (t) => {
  if (skip) return t.skip(skip);
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  assert.equal((await app.admin.adjustCashback(admin.userId, student.userId, { amount: 700, note: "Sorry your order was late" })).status, 200);
  assert.equal((await app.admin.adjustCashback(admin.userId, student.userId, { amount: -1_000, note: "Too much" })).status, 409);
  assert.equal((await app.admin.adjustCashback(admin.userId, student.userId, { amount: -200, note: "Duplicate credit" })).status, 200);
  assert.equal(await app.store.cashbackBalance(app.db, student.userId), 500);
  assert.equal(await app.db.auditLog.count({ where: { action: "cashback.adjusted", resourceId: student.userId } }), 2);
});
