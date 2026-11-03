/**
 * Manual bank transfer (PAYMENT_PROVIDER=MANUAL) against a disposable database, through the real routes: checkout
 * hands out the account number and a transfer code without calling any provider; "I've made the payment" only records
 * a claim and alerts every admin (in the app and by email); only an admin confirming at least the order's amount
 * creates the order, exactly once; a rejection or the 30-minute window closes an unclaimed checkout with no order;
 * and a student who said they paid is never closed automatically.
 *
 * Skips unless this test database has migration 20261103090000_manual_bank_transfer. No money moves and nothing
 * calls a provider. Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  asUser,
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  dbTestSkip,
  signInAs,
  testDb,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  cart: typeof import("../../app/api/cart/route");
  create: typeof import("../../app/api/payments/create/route");
  status: typeof import("../../app/api/payments/status/route");
  cancel: typeof import("../../app/api/payments/cancel/route");
  claim: typeof import("../../app/api/payments/manual/claim/route");
  admin: typeof import("../../app/api/admin/payments/[id]/manual/route");
  store: typeof import("./manual-transfer-store");
  email: typeof import("../email");
};
let app: App;
let skip: string | false = dbTestSkip;

const ACCOUNT = { MANUAL_TRANSFER_BANK_NAME: "OPay", MANUAL_TRANSFER_ACCOUNT_NUMBER: "6148466206", MANUAL_TRANSFER_ACCOUNT_NAME: "AvenzLAB" };
const ENV_KEYS = ["PAYMENT_PROVIDER", "APP_URL", ...Object.keys(ACCOUNT)] as const;
const savedEnv: Record<string, string | undefined> = {};
const MINUTE = 60_000;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const migrated = await db.$queryRaw<{ ok: boolean }[]>`select exists (select 1 from information_schema.columns where table_name = 'Payment' and column_name = 'transferCode') as ok`;
  if (!migrated[0]?.ok) { skip = "manual-transfer migration not applied to this test database"; return; }
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  Object.assign(process.env, ACCOUNT, { PAYMENT_PROVIDER: "MANUAL", APP_URL: "https://packam.example" });
  const [cart, create, status, cancel, claim, admin, store, email] = await Promise.all([
    import("../../app/api/cart/route"),
    import("../../app/api/payments/create/route"),
    import("../../app/api/payments/status/route"),
    import("../../app/api/payments/cancel/route"),
    import("../../app/api/payments/manual/claim/route"),
    import("../../app/api/admin/payments/[id]/manual/route"),
    import("./manual-transfer-store"),
    import("../email"),
  ]);
  app = { db, cart, create, status, cancel, claim, admin, store, email };
});
after(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await cleanupTestData();
});

type User = Awaited<ReturnType<typeof createTestUser>>;

/** Fails the test if anything tries the network: a bank transfer never calls a provider. */
async function noNetwork<T>(call: () => Promise<T>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("Bank-transfer tests never call the network."); }) as typeof fetch;
  try { return await call(); } finally { globalThis.fetch = realFetch; }
}

/** A student with one ₦1,500 item in the cart and a saved location; returns what checkout posts. */
async function studentAtCheckout() {
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Transfer rice", price: 1_500 }]);
  signInAs(student);
  const added = await callRoute(app.cart.POST, { method: "POST", path: "/api/cart", body: { productId: products[0].id, quantity: 1 } });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  const location = await createTestLocation(student.userId);
  return { student, body: { deliveryLocationId: location.id, reviewedTotal: 1_700, deliveryTier: "CRUISE", reviewedDeliveryFee: 200 } };
}

async function startTransfer() {
  const { student, body } = await studentAtCheckout();
  const key = randomUUID();
  const response = await noNetwork(() => asUser(student, () => callRoute(app.create.POST, { method: "POST", path: "/api/payments/create", headers: { "Idempotency-Key": key }, body })));
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const payment = await app.db.payment.findFirstOrThrow({ where: { userId: student.userId }, orderBy: { createdAt: "desc" } });
  return { student, body, key, response, payment };
}

const claim = (student: User, reference: string) => asUser(student, () => callRoute(app.claim.POST, { method: "POST", path: "/api/payments/manual/claim", body: { reference } }));
const statusOf = (student: User, reference: string) => asUser(student, () => callRoute(app.status.GET, { path: `/api/payments/status?reference=${encodeURIComponent(reference)}` }));
const adminAction = (admin: User, paymentId: string, body: Record<string, unknown>) => asUser(admin, () => callRoute(app.admin.POST, { method: "POST", path: `/api/admin/payments/${paymentId}/manual`, params: { id: paymentId }, body }));
const backdate = (paymentId: string, minutes: number) => app.db.payment.update({ where: { id: paymentId }, data: { createdAt: new Date(Date.now() - minutes * MINUTE) } });

async function verifiedAdmin() {
  const admin = await createTestUser("ADMIN");
  await app.db.user.update({ where: { id: admin.userId }, data: { emailVerifiedAt: new Date() } });
  const { email } = await app.db.user.findUniqueOrThrow({ where: { id: admin.userId }, select: { email: true } });
  return { admin, email };
}

test("checkout hands out the account and a transfer code, with no provider call; resuming keeps the same code", async (t) => {
  if (skip) return t.skip(skip);
  const { student, body, key, response, payment } = await startTransfer();
  assert.equal(payment.provider, "MANUAL");
  assert.equal(payment.status, "PENDING");
  assert.equal(payment.amount, 1_700);
  assert.match(payment.transferCode ?? "", /^PK-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
  assert.equal(response.json.cashierUrl, `/checkout/payment-result?reference=${payment.transactionReference}`);
  assert.equal(response.json.provider, "MANUAL");

  const again = await noNetwork(() => asUser(student, () => callRoute(app.create.POST, { method: "POST", path: "/api/payments/create", headers: { "Idempotency-Key": key }, body })));
  assert.equal(again.json.cashierUrl, response.json.cashierUrl);
  assert.equal((await app.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).transferCode, payment.transferCode, "one attempt, one code");

  const status = await statusOf(student, payment.transactionReference!);
  assert.equal(status.status, 200);
  assert.equal(status.json.status, "PENDING");
  const manual = status.json.manual as Record<string, unknown>;
  assert.deepEqual({ bank: manual.bankName, number: manual.accountNumber, name: manual.accountName, code: manual.code, amount: manual.amount, claimed: manual.claimed },
    { bank: "OPay", number: "6148466206", name: "AvenzLAB", code: payment.transferCode, amount: 1_700, claimed: false });
  assert.equal(new Date(manual.payBy as string).getTime(), payment.createdAt.getTime() + 30 * MINUTE);
});

test("with the account not set up, checkout refuses before creating anything", async (t) => {
  if (skip) return t.skip(skip);
  const { student, body } = await studentAtCheckout();
  const number = process.env.MANUAL_TRANSFER_ACCOUNT_NUMBER;
  process.env.MANUAL_TRANSFER_ACCOUNT_NUMBER = "12345";
  try {
    const response = await asUser(student, () => callRoute(app.create.POST, { method: "POST", path: "/api/payments/create", headers: { "Idempotency-Key": randomUUID() }, body }));
    assert.equal(response.status, 503);
    assert.equal(await app.db.payment.count({ where: { userId: student.userId } }), 0);
  } finally {
    process.env.MANUAL_TRANSFER_ACCOUNT_NUMBER = number;
  }
});

test("a claim only records the claim and alerts every admin once, in the app and by email", async (t) => {
  if (skip) return t.skip(skip);
  const { admin, email } = await verifiedAdmin();
  const { student, payment } = await startTransfer();
  app.email.clearTestOutbox();

  const first = await claim(student, payment.transactionReference!);
  assert.deepEqual(first.json, { status: "PENDING", claimed: true });
  const second = await claim(student, payment.transactionReference!);
  assert.deepEqual(second.json, { status: "PENDING", claimed: true });

  const after = await app.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(after.status, "PENDING", "a claim never marks anything paid");
  assert.equal(after.orderId, null);
  assert.ok(after.transferClaimedAt);
  const alerts = await app.db.notification.findMany({ where: { userId: admin.userId, idempotencyKey: `manual-transfer-claim:${payment.id}` } });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, new RegExp(payment.transferCode!));
  const mail = app.email.testOutbox().filter((message) => message.to === email);
  assert.equal(mail.length, 1, "one email per admin, however often the student taps");
  assert.match(mail[0].text, /₦1,700/);
  assert.match(mail[0].text, new RegExp(payment.transferCode!));
  assert.match(mail[0].text, /https:\/\/packam\.example\/admin\/payments/);
  assert.equal((await statusOf(student, payment.transactionReference!)).json.manual && ((await statusOf(student, payment.transactionReference!)).json.manual as { claimed: boolean }).claimed, true);

  // A student who said they paid can't cancel it out from under the admin.
  const cancelled = await asUser(student, () => callRoute(app.cancel.POST, { method: "POST", path: "/api/payments/cancel", body: { reference: payment.transactionReference } }));
  assert.equal(cancelled.status, 409);
  assert.match(cancelled.json.error ?? "", /told us you sent this money/);
  assert.equal((await app.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "PENDING");
});

test("only an admin confirming at least the amount creates the order, exactly once", async (t) => {
  if (skip) return t.skip(skip);
  const { admin } = await verifiedAdmin();
  const { student, payment } = await startTransfer();
  await claim(student, payment.transactionReference!);

  const outsider = await adminAction(student, payment.id, { action: "confirm", receivedAmount: 1_700 });
  assert.equal(outsider.status, 403, "students can't confirm");
  const short = await adminAction(admin, payment.id, { action: "confirm", receivedAmount: 1_699 });
  assert.equal(short.status, 400);
  assert.equal((await app.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "PENDING");

  const [a, b] = await Promise.all([
    adminAction(admin, payment.id, { action: "confirm", receivedAmount: 1_700 }),
    adminAction(admin, payment.id, { action: "confirm", receivedAmount: 1_700 }),
  ]);
  assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.json, b.json]));
  const paid = await app.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(paid.status, "SUCCESS");
  assert.equal(paid.providerReference, `manual:${payment.id}`);
  assert.equal(await app.db.order.count({ where: { userId: student.userId } }), 1, "two clicks, one order");
  const order = await app.db.order.findUniqueOrThrow({ where: { id: paid.orderId! } });
  assert.equal(order.total, 1_700);
  assert.equal(order.status, "FINDING_RUNNER");
  assert.equal(await app.db.auditLog.count({ where: { action: "payment.manual_confirmed", resourceId: payment.id } }), 1);
  assert.equal((await statusOf(student, payment.transactionReference!)).json.status, "SUCCESS");

  const late = await adminAction(admin, payment.id, { action: "reject" });
  assert.equal(late.status, 409, "a confirmed payment can't be rejected");
});

test("an overpayment confirms and reports the extra; a rejection closes it with no order and the cart kept", async (t) => {
  if (skip) return t.skip(skip);
  const { admin } = await verifiedAdmin();
  const over = await startTransfer();
  const confirmed = await adminAction(admin, over.payment.id, { action: "confirm", receivedAmount: 2_000 });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.extra, 300);

  const { student, payment } = await startTransfer();
  await claim(student, payment.transactionReference!);
  const rejected = await adminAction(admin, payment.id, { action: "reject", note: "Nothing arrived" });
  assert.equal(rejected.status, 200);
  const failed = await app.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.orderId, null);
  assert.equal(await app.db.cartItem.count({ where: { cart: { userId: student.userId } } }), 1, "the cart is untouched");
  const confirmAfter = await adminAction(admin, payment.id, { action: "confirm", receivedAmount: 1_700 });
  assert.equal(confirmAfter.status, 409);
  assert.equal(await app.db.order.count({ where: { userId: student.userId } }), 0);
});

test("30 minutes: an unclaimed checkout closes (scheduled or on view); a claimed one is never closed, admins are reminded once", async (t) => {
  if (skip) return t.skip(skip);
  const { admin, email } = await verifiedAdmin();
  const unclaimed = await startTransfer();
  const onTime = await startTransfer();
  const viewed = await startTransfer();
  const claimed = await startTransfer();
  await claim(claimed.student, claimed.payment.transactionReference!);
  await backdate(unclaimed.payment.id, 36);
  await backdate(onTime.payment.id, 34);
  await backdate(viewed.payment.id, 36);
  await backdate(claimed.payment.id, 120);
  await app.db.payment.update({ where: { id: claimed.payment.id }, data: { transferClaimedAt: new Date(Date.now() - 31 * MINUTE) } });

  // On view, before any scheduled run.
  const seen = await statusOf(viewed.student, viewed.payment.transactionReference!);
  assert.deepEqual({ status: seen.json.status, expired: seen.json.expired }, { status: "FAILED", expired: true });
  const lateClaim = await claim(viewed.student, viewed.payment.transactionReference!);
  assert.deepEqual(lateClaim.json, { status: "FAILED" }, "no claim after the window");

  app.email.clearTestOutbox();
  const run = await app.store.runManualTransferHousekeeping();
  assert.ok(run.expired >= 1 && run.reminded >= 1 && run.failed === 0, JSON.stringify(run));
  const state = async (id: string) => (await app.db.payment.findUniqueOrThrow({ where: { id } })).status;
  assert.equal(await state(unclaimed.payment.id), "FAILED");
  assert.equal(await state(onTime.payment.id), "PENDING", "the 5-minute grace still holds it");
  assert.equal(await state(claimed.payment.id), "PENDING", "money may be in the account: only an admin decides");
  const told = await app.db.notification.findFirst({ where: { userId: unclaimed.student.userId, title: "Bank transfer time ran out" } });
  assert.ok(told, "the student is told");

  await app.store.runManualTransferHousekeeping();
  assert.equal(await app.db.notification.count({ where: { userId: admin.userId, idempotencyKey: `manual-transfer-reminder:${claimed.payment.id}` } }), 1, "reminded once, not every 5 minutes");
  assert.equal(app.email.testOutbox().filter((message) => message.to === email && message.purpose === "manual-transfer-reminder" && message.text.includes(claimed.payment.transferCode!)).length, 1);

  // The admin can still confirm the claimed one after the window.
  const confirmed = await adminAction(admin, claimed.payment.id, { action: "confirm", receivedAmount: 1_700 });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
});

test("a student can cancel an unpaid transfer they haven't claimed", async (t) => {
  if (skip) return t.skip(skip);
  const { student, payment } = await startTransfer();
  const cancelled = await asUser(student, () => callRoute(app.cancel.POST, { method: "POST", path: "/api/payments/cancel", body: { reference: payment.transactionReference } }));
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(cancelled.json.status, "CANCELLED");
  assert.equal((await app.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "FAILED");
  assert.equal((await claim(student, payment.transactionReference!)).json.status, "FAILED");
});
