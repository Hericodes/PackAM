/**
 * Admin levels, admins delivering, and admins ordering for students, against a disposable database through the real
 * routes (no network: bank transfer only):
 * - the super admin (SUPER_ADMIN_EMAILS) adds and removes admins; a normal admin can't, and can't open analytics;
 * - an admin who goes available gets a verified runner profile and is offered orders like a runner;
 * - an admin's cart becomes a student's order: the student is the payer and customer, the admin's cart is cleared,
 *   the student is told how to pay, and confirming the transfer creates the student's order.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  asUser,
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestUser,
  dbTestSkip,
  testDb,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";

const skip: string | false = dbTestSkip;
type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  admins: typeof import("../../app/api/admin/admins/route");
  analytics: typeof import("../../app/api/admin/analytics/route");
  availability: typeof import("../../app/api/runner/availability/route");
  cart: typeof import("../../app/api/cart/route");
  place: typeof import("../../app/api/admin/orders/place/route");
  students: typeof import("../../app/api/admin/students/route");
  manual: typeof import("../../app/api/admin/payments/[id]/manual/route");
};
let app: App;

const ACCOUNT = { MANUAL_TRANSFER_BANK_NAME: "OPay", MANUAL_TRANSFER_ACCOUNT_NUMBER: "6148466206", MANUAL_TRANSFER_ACCOUNT_NAME: "AvenzLAB" };
const ENV_KEYS = ["PAYMENT_PROVIDER", "APP_URL", "SUPER_ADMIN_EMAILS", ...Object.keys(ACCOUNT)] as const;
const savedEnv: Record<string, string | undefined> = {};
const PIN = "482915";

before(async () => {
  if (skip) return;
  const db = await testDb();
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  Object.assign(process.env, ACCOUNT, { PAYMENT_PROVIDER: "MANUAL", APP_URL: "https://packam.example" });
  const [admins, analytics, availability, cart, place, students, manual] = await Promise.all([
    import("../../app/api/admin/admins/route"),
    import("../../app/api/admin/analytics/route"),
    import("../../app/api/runner/availability/route"),
    import("../../app/api/cart/route"),
    import("../../app/api/admin/orders/place/route"),
    import("../../app/api/admin/students/route"),
    import("../../app/api/admin/payments/[id]/manual/route"),
  ]);
  app = { db, admins, analytics, availability, cart, place, students, manual };
});
after(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await cleanupTestData();
});

type User = Awaited<ReturnType<typeof createTestUser>>;
const emailOf = async (user: User) => (await app.db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { email: true } })).email;

test("the super admin adds and removes admins; normal admins can't, and can't open analytics", async (t) => {
  if (skip) return t.skip(skip);
  const owner = await createTestUser("ADMIN");
  const helper = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  process.env.SUPER_ADMIN_EMAILS = await emailOf(owner);

  const byHelper = await asUser(helper, () => callRoute(app.admins.POST, { method: "POST", path: "/api/admin/admins", body: { email: "x@packam.test" } }));
  assert.equal(byHelper.status, 403, "a normal admin can't add admins");
  assert.equal((await asUser(helper, () => callRoute(app.analytics.GET, { path: "/api/admin/analytics?range=7d" }))).status, 403, "or open analytics");

  const studentEmail = await emailOf(student);
  const added = await asUser(owner, () => callRoute(app.admins.POST, { method: "POST", path: "/api/admin/admins", body: { email: studentEmail.toUpperCase() } }));
  assert.equal(added.status, 200, JSON.stringify(added.json));
  assert.equal((await app.db.user.findUniqueOrThrow({ where: { id: student.userId }, select: { role: true } })).role, "ADMIN");
  assert.equal(await app.db.auditLog.count({ where: { action: "admin.added", resourceId: student.userId } }), 1);
  assert.equal((await asUser(owner, () => callRoute(app.admins.POST, { method: "POST", path: "/api/admin/admins", body: { email: "nobody-" + randomUUID() + "@packam.test" } }))).status, 404, "they must have signed up");

  assert.equal((await asUser(owner, () => callRoute(app.admins.DELETE, { method: "DELETE", path: "/api/admin/admins", body: { userId: owner.userId, role: "STUDENT" } }))).status, 409, "never yourself");
  const removed = await asUser(owner, () => callRoute(app.admins.DELETE, { method: "DELETE", path: "/api/admin/admins", body: { userId: student.userId, role: "STUDENT" } }));
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal((await app.db.user.findUniqueOrThrow({ where: { id: student.userId }, select: { role: true } })).role, "STUDENT");
  delete process.env.SUPER_ADMIN_EMAILS;
});

test("an admin who goes available gets a verified runner profile", async (t) => {
  if (skip) return t.skip(skip);
  const admin = await createTestUser("ADMIN");
  const on = await asUser(admin, () => callRoute(app.availability.PATCH, { method: "PATCH", path: "/api/runner/availability", body: { available: true } }));
  assert.equal(on.status, 200, JSON.stringify(on.json));
  const profile = await app.db.runnerProfile.findUniqueOrThrow({ where: { userId: admin.userId }, select: { isVerified: true, isAvailable: true } });
  assert.deepEqual(profile, { isVerified: true, isAvailable: true });
  const off = await asUser(admin, () => callRoute(app.availability.PATCH, { method: "PATCH", path: "/api/runner/availability", body: { available: false } }));
  assert.equal(off.status, 200);
});

test("an admin's cart becomes a student's order: the student pays, the admin's cart is cleared, confirming makes the order", async (t) => {
  if (skip) return t.skip(skip);
  const admin = await createTestUser("ADMIN");
  await app.db.adminPaymentPin.create({ data: { userId: admin.userId, pinHash: await bcrypt.hash(PIN, 4) } });
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Admin-ordered rice", price: 1_500 }]);

  const added = await asUser(admin, () => callRoute(app.cart.POST, { method: "POST", path: "/api/cart", body: { productId: products[0].id, quantity: 1 } }));
  assert.equal(added.status, 200, JSON.stringify(added.json));

  const search = (await emailOf(student)).slice(0, 12);
  const found = await asUser(admin, () => callRoute(app.students.GET, { path: `/api/admin/students?q=${encodeURIComponent(search)}` }));
  assert.ok((found.json.students as Array<{ id: string }>).some((row) => row.id === student.userId), "the student can be found");

  const key = randomUUID();
  const body = { cart: "stuff", studentId: student.userId, address: "Block C, Room 12, Female Hostel", label: "Hostel", deliveryTier: "CRUISE", reviewedDeliveryFee: 200, reviewedTotal: 1_700 };
  const placed = await asUser(admin, () => callRoute(app.place.POST, { method: "POST", path: "/api/admin/orders/place", headers: { "Idempotency-Key": key }, body }));
  assert.equal(placed.status, 200, JSON.stringify(placed.json));
  const result = placed.json.placed as { reference: string; amount: number; payment: { kind: string; code: string } };
  assert.equal(result.amount, 1_700);
  assert.equal(result.payment.kind, "transfer");

  const payment = await app.db.payment.findUniqueOrThrow({ where: { transactionReference: result.reference }, select: { id: true, userId: true, status: true, transferCode: true, transferClaimedAt: true, checkoutSnapshot: true } });
  assert.equal(payment.userId, student.userId, "the student pays");
  assert.equal(payment.transferCode, result.payment.code);
  assert.ok(payment.transferClaimedAt, "it waits for an admin to confirm, with no 30-minute expiry");
  assert.equal((payment.checkoutSnapshot as { placedByAdminId?: string }).placedByAdminId, admin.userId);
  assert.equal(await app.db.cartItem.count({ where: { cart: { userId: admin.userId } } }), 0, "the admin's cart is cleared straight away");
  assert.equal(await app.db.notification.count({ where: { userId: student.userId, relatedType: "PAYMENT", relatedId: result.reference } }), 1, "the student is told how to pay");
  assert.equal(await app.db.savedLocation.count({ where: { userId: student.userId, address: body.address } }), 1, "the address is saved to the student");

  const again = await asUser(admin, () => callRoute(app.place.POST, { method: "POST", path: "/api/admin/orders/place", headers: { "Idempotency-Key": key }, body }));
  assert.equal(again.status, 200, "a double click resumes the same order");
  assert.equal(await app.db.payment.count({ where: { userId: student.userId } }), 1);

  const confirmed = await asUser(admin, () => callRoute(app.manual.POST, { method: "POST", path: `/api/admin/payments/${payment.id}/manual`, params: { id: payment.id }, body: { pin: PIN, action: "confirm", receivedAmount: 1_700 } }));
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  const order = await app.db.order.findFirstOrThrow({ where: { userId: student.userId }, select: { total: true, deliveryAddress: true } });
  assert.deepEqual(order, { total: 1_700, deliveryAddress: body.address });
});
