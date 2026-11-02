/**
 * Delivery tiers at payment against a disposable database, through the real payment route, payment lifecycle, admin
 * payment review and order API: each speed charges the cart's subtotal plus that speed's current fee and freezes the
 * speed, fee, window and settings version into the attempt; a paid order keeps them whatever the settings do later; a
 * speed that is off is refused with nothing created and is never swapped for another; and a database without the
 * tier migration behaves exactly as before tiers (Cruise Mode only, ₦200, no tier rows).
 *
 * Tier tests skip unless this test database has migration 20261101150000_delivery_tiers; the lag test runs only
 * without it. DeliveryTierSetting is global, so every test that changes it restores the approved values.
 * Payment boundary: no money moves and nothing calls OPay or Paystack (see payUpToProvider and providerConfirms).
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  APPROVED_DELIVERY_TIERS,
  asUser,
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  dbTestSkip as skip,
  deliveryTierTablesMigrated,
  restoreApprovedDeliveryTiers,
  signInAs,
  testDb,
  trustedTestVerifiedPayment,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Prisma } from "@prisma/client";
import type { VerificationDeps } from "./opay-verification";
import type { RevisedCheckout } from "./payment-errors";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  cart: typeof import("../../app/api/cart/route");
  orderApi: typeof import("../../app/api/orders/[id]/route");
  paymentCreate: typeof import("../../app/api/payments/create/route");
  payments: typeof import("./payment-lifecycle");
  errors: typeof import("./payment-errors");
  review: typeof import("./payment-review");
  store: typeof import("./checkout-cancellation-store");
  tiers: typeof import("../delivery-tier-store");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [cart, orderApi, paymentCreate, payments, errors, review, store, tiers] = await Promise.all([
    import("../../app/api/cart/route"),
    import("../../app/api/orders/[id]/route"),
    import("../../app/api/payments/create/route"),
    import("./payment-lifecycle"),
    import("./payment-errors"),
    import("./payment-review"),
    import("./checkout-cancellation-store"),
    import("../delivery-tier-store"),
  ]);
  app = { db, cart, orderApi, paymentCreate, payments, errors, review, store, tiers };
});
after(async () => {
  // Each test restores the settings it changed; this covers one that failed half-way.
  try {
    if (!skip) await restoreApprovedDeliveryTiers();
  } finally {
    await cleanupTestData();
  }
});

type User = Awaited<ReturnType<typeof createTestUser>>;
type Tier = (typeof APPROVED_DELIVERY_TIERS)[number]["tier"];

const NOT_MIGRATED = "delivery-tier migration not applied to this test database";
const TIER_KEYS = ["deliveryTier", "deliveryEtaMinMinutes", "deliveryEtaMaxMinutes", "deliveryTierSettingsVersion"] as const;
/** Stored as an attempt's checkout link where a test resumes it through the route. Never opened. */
const TEST_CASHIER_URL = "https://sandboxcashier.opaycheckout.com/test-no-money";
const COULD_NOT_START = "We couldn't start your payment. Your cart is safe. Please try again.";

const approved = (tier: Tier) => APPROVED_DELIVERY_TIERS.find((row) => row.tier === tier)!;
const settingsVersion = async (tier: Tier) => (await app.db.deliveryTierSetting.findUniqueOrThrow({ where: { tier }, select: { version: true } })).version;

/** Puts items in the student's cart through the real cart API and gives them a saved delivery location. */
async function cartReady(student: User, items: Array<{ productId: string; quantity: number }>) {
  signInAs(student);
  for (const item of items) {
    const added = await callRoute(app.cart.POST, { method: "POST", path: "/api/cart", body: item });
    assert.equal(added.status, 200, JSON.stringify(added.json));
  }
  return createTestLocation(student.userId);
}

/** A checkout attempt for `tier` through the payment lifecycle, reviewed at that speed's approved fee. */
function attemptFor(student: User, locationId: string, subtotal: number, tier: Tier, key = randomUUID()) {
  const { fee } = approved(tier);
  signInAs(student);
  return app.payments.createPaymentAttempt("OPAY", locationId, key, null, subtotal + fee, { tier, reviewedDeliveryFee: fee });
}

/**
 * POST /api/payments/create as `student`, through the real route (each call uses one of the student's five payment
 * starts per ten minutes). A new attempt stops where the route would ask the provider for its hosted checkout page:
 * APP_URL is unset for the call, so the route answers its ordinary "couldn't start" 400 there instead, and a fetch
 * guard fails the test if anything tries the network. Everything before that (validation, pricing, the attempt and its
 * snapshot) is exactly what production runs. Resuming an attempt that has a checkout link answers 200 with it.
 */
async function payUpToProvider(student: User, body: Record<string, unknown>, key = randomUUID()) {
  const appUrl = process.env.APP_URL;
  const realFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("Database tests never call a payment provider.");
  }) as typeof fetch;
  delete process.env.APP_URL;
  try {
    const response = await asUser(student, () => callRoute(app.paymentCreate.POST, { method: "POST", path: "/api/payments/create", headers: { "Idempotency-Key": key }, body }));
    assert.equal(networkCalls, 0, "no request reaches a payment provider");
    return response;
  } finally {
    globalThis.fetch = realFetch;
    if (appUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = appUrl;
  }
}

/** payUpToProvider's answer once the attempt exists: the route got as far as the provider step. */
function reachedProvider(response: { status: number; json: { error?: string } }) {
  assert.equal(response.status, 400, JSON.stringify(response.json));
  assert.equal(response.json.error, COULD_NOT_START);
}

async function snapshotOf(paymentId: string) {
  const { checkoutSnapshot } = await app.db.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { checkoutSnapshot: true } });
  return checkoutSnapshot as Record<string, unknown>;
}

/** The delivery part of an attempt's checkout snapshot. */
async function deliveryOf(paymentId: string) {
  const snapshot = await snapshotOf(paymentId);
  return { deliveryFee: snapshot.deliveryFee, ...Object.fromEntries(TIER_KEYS.map((key) => [key, snapshot[key]])) };
}

/** What checkout freezes for `tier` at its approved fee and window. */
function frozen(tier: Tier, deliveryTierSettingsVersion: number | null) {
  const { fee, etaMinMinutes, etaMaxMinutes } = approved(tier);
  return { deliveryFee: fee, deliveryTier: tier, deliveryEtaMinMinutes: etaMinMinutes, deliveryEtaMaxMinutes: etaMaxMinutes, deliveryTierSettingsVersion };
}

/** Turns an attempt into one started before delivery tiers: the same snapshot (its ₦200 fee included) without the tier keys. */
async function makeLegacy(paymentId: string) {
  const snapshot = await snapshotOf(paymentId);
  for (const key of TIER_KEYS) delete snapshot[key];
  await app.db.payment.update({ where: { id: paymentId }, data: { checkoutSnapshot: snapshot as Prisma.InputJsonValue } });
}

/** Provider stand-in for admin verification: the same lifecycle as production, with OPay's success record injected. */
function providerConfirms(attempt: { transactionReference: string | null; amount: number }): VerificationDeps {
  return {
    ...app.store.opayStatusDeps,
    queryStatus: async () => ({ reference: attempt.transactionReference!, transactionId: `TEST-NO-MONEY-${randomUUID()}`, status: "SUCCESS", amount: { total: attempt.amount * 100, currency: "NGN" } }),
  };
}

const deliveryAlerts = (adminId: string, orderId: string) => app.db.notification.count({ where: { userId: adminId, orderId, title: "Delivery speed not recorded" } });
const orderDelivery = (response: { json: Record<string, unknown> }) => (response.json.order as { delivery: unknown }).delivery;

test("migration seeds all three tiers on, with the approved prices and windows", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const { db, tiers } = app;
  const rows = await db.deliveryTierSetting.findMany({ select: { tier: true, fee: true, enabled: true, etaMinMinutes: true, etaMaxMinutes: true, version: true } });
  assert.equal(rows.length, 3);
  for (const expected of APPROVED_DELIVERY_TIERS) {
    const row = rows.find((candidate) => candidate.tier === expected.tier);
    assert.ok(row, expected.tier);
    const { version, ...settings } = row;
    assert.deepEqual(settings, expected);
    // The seed writes 1. Admin tests that run earlier against the same database may have saved changes since, and
    // restoring the approved values never lowers a version, so only "a valid version" is checked here.
    assert.ok(Number.isSafeInteger(version) && version >= 1, `${expected.tier}: version ${version}`);
  }
  const quotes = await tiers.readDeliveryTierQuotes(db);
  assert.equal(quotes.source, "settings");
  assert.deepEqual(
    quotes.quotes.map((quote) => [quote.tier, quote.available, quote.fee, quote.etaMinMinutes, quote.etaMaxMinutes]),
    [["CRUISE", true, 200, 20, 30], ["SHARP", true, 300, 15, 25], ["OYA", true, 400, 10, 15]],
  );
});

test("each tier charges subtotal + its fee and freezes tier, fee, window and settings version", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  await restoreApprovedDeliveryTiers();
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Tier noodles", price: 1_500 }]);
  const location = await cartReady(student, [{ productId: products[0].id, quantity: 2 }]);
  for (const { tier, fee } of APPROVED_DELIVERY_TIERS) {
    const attempt = await attemptFor(student, location.id, 3_000, tier);
    assert.equal(attempt.status, "PENDING");
    assert.equal(attempt.amount, 3_000 + fee, `${tier}: the cart's subtotal + the speed's fee`);
    assert.deepEqual(await deliveryOf(attempt.id), frozen(tier, await settingsVersion(tier)), tier);
    assert.equal((await snapshotOf(attempt.id)).subtotal, 3_000);
  }
});

test("the payment route: no tier is Cruise Mode; an unknown tier is 400; a disabled tier is 409 and nothing is created or switched", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const { db, payments, errors } = app;
  await restoreApprovedDeliveryTiers();
  const { products } = await createTestCatalogue([{ name: "Route biscuits", price: 700 }]);
  try {
    // A checkout tab opened before delivery tiers sends no tier: that is Cruise Mode, at Cruise Mode's current fee.
    const oldTab = await createTestUser("STUDENT");
    const oldTabLocation = await cartReady(oldTab, [{ productId: products[0].id, quantity: 1 }]);
    const key = randomUUID();
    const oldTabBody = { deliveryLocationId: oldTabLocation.id, reviewedTotal: 900 };
    reachedProvider(await payUpToProvider(oldTab, oldTabBody, key));
    const created = await db.payment.findMany({ where: { userId: oldTab.userId }, select: { id: true, amount: true, provider: true } });
    assert.equal(created.length, 1);
    assert.equal(created[0].amount, 700 + 200);
    assert.deepEqual(await deliveryOf(created[0].id), frozen("CRUISE", await settingsVersion("CRUISE")));
    // The same tab trying again (same key, still no tier) resumes that attempt and gets its checkout link back.
    await db.payment.update({ where: { id: created[0].id }, data: { cashierUrl: TEST_CASHIER_URL } });
    const resumed = await payUpToProvider(oldTab, oldTabBody, key);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.json));
    assert.deepEqual(resumed.json, { cashierUrl: TEST_CASHIER_URL, provider: created[0].provider });
    assert.equal(await db.payment.count({ where: { userId: oldTab.userId } }), 1);

    // A speed the server doesn't know is refused, never read as Cruise Mode.
    const student = await createTestUser("STUDENT");
    const location = await cartReady(student, [{ productId: products[0].id, quantity: 1 }]);
    for (const deliveryTier of ["TURBO", null]) {
      const unknown = await payUpToProvider(student, { deliveryLocationId: location.id, deliveryTier, reviewedTotal: 900, reviewedDeliveryFee: 200 });
      assert.equal(unknown.status, 400, String(deliveryTier));
      assert.deepEqual(unknown.json, { error: "Choose a delivery speed, then pay.", code: "INVALID_DELIVERY_TIER" });
    }

    // Oya Now! is switched off after the student chose it: refused, nothing created, and no other speed used instead.
    await db.deliveryTierSetting.update({ where: { tier: "OYA" }, data: { enabled: false } });
    const refused = await payUpToProvider(student, { deliveryLocationId: location.id, deliveryTier: "OYA", reviewedTotal: 1_100, reviewedDeliveryFee: 400 });
    assert.equal(refused.status, 409, JSON.stringify(refused.json));
    assert.deepEqual(refused.json, {
      error: "Oya Now! isn’t available right now. Refresh checkout and choose another delivery speed. Nothing has been charged.",
      code: "DELIVERY_TIER_UNAVAILABLE",
      tier: "OYA",
    });
    signInAs(student);
    await assert.rejects(
      payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 1_100, { tier: "OYA", reviewedDeliveryFee: 400 }),
      (error: Error) => error instanceof errors.DeliveryTierUnavailableError && error.tier === "OYA" && error.label === "Oya Now!",
    );
    assert.equal(await db.payment.count({ where: { userId: student.userId } }), 0, "no attempt at all: not for Oya Now!, and no Cruise Mode one in its place");
  } finally {
    await restoreApprovedDeliveryTiers();
  }
});

test("manipulated prices are refused: a stale delivery fee needs confirmation, and money fields in the request are ignored", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const { db, payments, errors } = app;
  await restoreApprovedDeliveryTiers();
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Repriced charger", price: 1_000 }]);
  const location = await cartReady(student, [{ productId: products[0].id, quantity: 1 }]);
  const pay = (body: Record<string, unknown>) => payUpToProvider(student, { deliveryLocationId: location.id, deliveryTier: "SHARP", ...body });
  const attempts = () => db.payment.findMany({ where: { userId: student.userId }, select: { id: true, amount: true } });
  try {
    // An admin raises Sharp Sharp to ₦350 after the student reviewed it at ₦300.
    await db.deliveryTierSetting.update({ where: { tier: "SHARP" }, data: { fee: 350 } });
    const stale = await pay({ reviewedTotal: 1_300, reviewedDeliveryFee: 300 });
    assert.equal(stale.status, 409, JSON.stringify(stale.json));
    assert.equal(stale.json.code, "PRICE_CHANGED");
    const { lines, ...revised } = stale.json.revised as RevisedCheckout;
    assert.deepEqual(revised, {
      subtotal: 1_000, deliveryFee: 350, total: 1_350, reviewedTotal: 1_300, reviewedDeliveryFee: 300,
      deliveryTier: "SHARP", deliveryTierLabel: "Sharp Sharp", deliveryEtaMinMinutes: 15, deliveryEtaMaxMinutes: 25,
    });
    assert.equal(lines.length, 1);
    assert.equal((await attempts()).length, 0, "nothing is created until the student confirms");

    // A total that happens to match isn't enough: the fee they saw must match too.
    signInAs(student);
    await assert.rejects(payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 1_350, { tier: "SHARP", reviewedDeliveryFee: 300 }), (error: Error) => {
      assert.ok(error instanceof errors.PriceChangedError);
      assert.deepEqual([error.revised.deliveryFee, error.revised.reviewedDeliveryFee, error.revised.total, error.revised.reviewedTotal], [350, 300, 1_350, 1_350]);
      return true;
    });

    // Money fields in the body are never read: with stale reviewed values the answer carries the server's numbers ...
    const tamperedStale = await pay({ reviewedTotal: 1, reviewedDeliveryFee: 1, deliveryFee: 1, amount: 1, total: 1 });
    assert.equal(tamperedStale.status, 409);
    const tamperedRevised = tamperedStale.json.revised as RevisedCheckout;
    assert.deepEqual([tamperedRevised.deliveryFee, tamperedRevised.total], [350, 1_350]);
    assert.equal((await attempts()).length, 0);
    // ... and with the right ones the server's amount is charged, never a value from the request.
    reachedProvider(await pay({ reviewedTotal: 1_350, reviewedDeliveryFee: 350, deliveryFee: 1, amount: 1, total: 1 }));
    // Confirming the revised breakdown pays exactly it.
    reachedProvider(await pay({ reviewedTotal: revised.total, reviewedDeliveryFee: revised.deliveryFee }));
    const created = await attempts();
    assert.deepEqual(created.map((attempt) => attempt.amount), [1_350, 1_350]);
    for (const attempt of created) assert.deepEqual(await deliveryOf(attempt.id), { ...frozen("SHARP", await settingsVersion("SHARP")), deliveryFee: 350 });
  } finally {
    await restoreApprovedDeliveryTiers();
  }
});

test("an idempotency key is never reused for another tier", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const { db, payments, errors } = app;
  await restoreApprovedDeliveryTiers();
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Keyed notebook", price: 500 }]);
  const location = await cartReady(student, [{ productId: products[0].id, quantity: 1 }]);
  const mismatch = (error: Error) => error instanceof errors.CheckoutAttemptMismatchError;
  try {
    const key = randomUUID();
    const sharp = await attemptFor(student, location.id, 500, "SHARP", key);
    await assert.rejects(attemptFor(student, location.id, 500, "OYA", key), mismatch, "another speed");
    signInAs(student);
    await assert.rejects(payments.createPaymentAttempt("OPAY", location.id, key, null, 700), mismatch, "no speed sent is Cruise Mode: another speed too");
    assert.equal((await attemptFor(student, location.id, 500, "SHARP", key)).id, sharp.id, "the same key and speed resume the attempt");

    // Through the route: 409 CHECKOUT_CHANGED for another speed; the same speed gets its checkout link back.
    await db.payment.update({ where: { id: sharp.id }, data: { cashierUrl: TEST_CASHIER_URL } });
    const changed = await payUpToProvider(student, { deliveryLocationId: location.id, deliveryTier: "OYA", reviewedTotal: 900, reviewedDeliveryFee: 400 }, key);
    assert.equal(changed.status, 409, JSON.stringify(changed.json));
    assert.deepEqual(changed.json, { error: "Your checkout changed since this payment was started. Refresh checkout, then pay. Nothing has been charged.", code: "CHECKOUT_CHANGED" });
    const resumed = await payUpToProvider(student, { deliveryLocationId: location.id, deliveryTier: "SHARP", reviewedTotal: 800, reviewedDeliveryFee: 300 }, key);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.json));
    assert.equal(resumed.json.cashierUrl, TEST_CASHIER_URL);

    // Resuming comes before any pricing: switching Sharp Sharp off doesn't strand an attempt already started with it.
    await db.deliveryTierSetting.update({ where: { tier: "SHARP" }, data: { enabled: false } });
    assert.equal((await attemptFor(student, location.id, 500, "SHARP", key)).id, sharp.id);
    await restoreApprovedDeliveryTiers();

    // An attempt from before delivery tiers resumes for an old tab (no tier sent), and for no other speed.
    const legacyKey = randomUUID();
    signInAs(student);
    const legacy = await payments.createPaymentAttempt("OPAY", location.id, legacyKey, null, 700);
    await makeLegacy(legacy.id);
    signInAs(student);
    assert.equal((await payments.createPaymentAttempt("OPAY", location.id, legacyKey, null, 700)).id, legacy.id);
    await assert.rejects(attemptFor(student, location.id, 500, "SHARP", legacyKey), mismatch);

    // Two first requests racing with one key for two speeds: one attempt is created, the other request is refused.
    const raceKey = randomUUID();
    const raced = await Promise.allSettled([attemptFor(student, location.id, 500, "SHARP", raceKey), attemptFor(student, location.id, 500, "OYA", raceKey)]);
    const statuses = raced.map((result) => result.status === "fulfilled" ? "fulfilled" : (result.reason as Error).name);
    assert.deepEqual([...statuses].sort(), ["CheckoutAttemptMismatchError", "fulfilled"], JSON.stringify(statuses));
    assert.equal(await db.payment.count({ where: { userId: student.userId, idempotencyKey: raceKey } }), 1);
  } finally {
    await restoreApprovedDeliveryTiers();
  }
});

test("a paid order keeps its tier, fee, window and due time", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const { db, payments, orderApi } = app;
  await restoreApprovedDeliveryTiers();
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Sharp textbook", price: 1_200 }]);
  const location = await cartReady(student, [{ productId: products[0].id, quantity: 1 }]);
  const attempt = await attemptFor(student, location.id, 1_200, "SHARP");
  const { orderId } = await payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));

  const order = await db.order.findUniqueOrThrow({ where: { id: orderId! }, select: { status: true, subtotal: true, deliveryFee: true, total: true, findingRunnerAt: true } });
  assert.equal(order.status, "FINDING_RUNNER");
  assert.deepEqual([order.subtotal, order.deliveryFee, order.total], [1_200, 300, 1_500]);
  const { dueAt, ...row } = await db.orderDeliveryTier.findUniqueOrThrow({ where: { orderId: orderId! }, select: { tier: true, etaMinMinutes: true, etaMaxMinutes: true, dueAt: true, settingsVersion: true, escalatedAt: true } });
  assert.deepEqual(row, { tier: "SHARP", etaMinMinutes: 15, etaMaxMinutes: 25, settingsVersion: await settingsVersion("SHARP"), escalatedAt: null });
  assert.ok(order.findingRunnerAt);
  assert.equal(dueAt.getTime(), order.findingRunnerAt.getTime() + 25 * 60_000, "due when payment was confirmed + the window's upper end");

  signInAs(student);
  const tracked = await callRoute(orderApi.GET, { params: { id: orderId! } });
  assert.equal(tracked.status, 200);
  assert.deepEqual(orderDelivery(tracked), { tier: "SHARP", label: "Sharp Sharp", etaMinMinutes: 15, etaMaxMinutes: 25, dueAt: dueAt.toISOString() });
});

test("no downgrade: a speed turned off or repriced after payment started is still delivered at the speed and fee paid", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const { db, payments, review } = app;
  await restoreApprovedDeliveryTiers();
  const admin = await createTestUser("ADMIN");
  const { products } = await createTestCatalogue([{ name: "Urgent charger", price: 800 }]);
  const startOya = async () => {
    const student = await createTestUser("STUDENT");
    return attemptFor(student, (await cartReady(student, [{ productId: products[0].id, quantity: 1 }])).id, 800, "OYA");
  };
  const byWebhook = await startOya();
  const byAdminRetry = await startOya();
  try {
    // While both students are paying, an admin reprices Oya Now! and switches it off.
    await db.deliveryTierSetting.update({ where: { tier: "OYA" }, data: { fee: 999, enabled: false } });
    const webhook = await payments.completeVerifiedPayment(trustedTestVerifiedPayment(byWebhook));
    const retried = await review.retryPaymentVerification(admin.userId, byAdminRetry.id, providerConfirms(byAdminRetry));
    assert.equal(retried.body.outcome, "CONFIRMED_SUCCESS", JSON.stringify(retried.body));
    const { orderId: retriedOrderId } = await db.payment.findUniqueOrThrow({ where: { id: byAdminRetry.id }, select: { orderId: true } });

    for (const orderId of [webhook.orderId!, retriedOrderId!]) {
      assert.deepEqual(await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { deliveryFee: true, total: true } }), { deliveryFee: 400, total: 1_200 }, "the fee paid, not the new price");
      assert.deepEqual(await db.orderDeliveryTier.findUnique({ where: { orderId }, select: { tier: true, etaMinMinutes: true, etaMaxMinutes: true } }), { tier: "OYA", etaMinMinutes: 10, etaMaxMinutes: 15 }, "still Oya Now!, never downgraded");
      assert.equal(await deliveryAlerts(admin.userId, orderId), 0);
    }
  } finally {
    await restoreApprovedDeliveryTiers();
  }
});

test("historical orders never change; orders without a tier row show Standard delivery", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const { db, payments, orderApi } = app;
  await restoreApprovedDeliveryTiers();
  const admin = await createTestUser("ADMIN");
  const { products } = await createTestCatalogue([{ name: "History snack", price: 600 }]);
  const paidState = (orderIds: string[]) => Promise.all(orderIds.map(async (orderId) => ({
    money: await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { subtotal: true, deliveryFee: true, total: true } }),
    row: await db.orderDeliveryTier.findUnique({ where: { orderId } }),
  })));
  try {
    // One paid order at each speed.
    const paid: string[] = [];
    for (const { tier } of APPROVED_DELIVERY_TIERS) {
      const student = await createTestUser("STUDENT");
      const attempt = await attemptFor(student, (await cartReady(student, [{ productId: products[0].id, quantity: 1 }])).id, 600, tier);
      paid.push((await payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt))).orderId!);
    }
    // And a checkout started before delivery tiers, still with the provider.
    const legacyStudent = await createTestUser("STUDENT");
    const legacyLocation = await cartReady(legacyStudent, [{ productId: products[0].id, quantity: 1 }]);
    signInAs(legacyStudent);
    const legacy = await payments.createPaymentAttempt("OPAY", legacyLocation.id, randomUUID(), null, 800);
    await makeLegacy(legacy.id);

    const asPaid = await paidState(paid);
    for (const [index, { money, row }] of asPaid.entries()) {
      assert.equal(money.deliveryFee, APPROVED_DELIVERY_TIERS[index].fee);
      assert.equal(row?.tier, APPROVED_DELIVERY_TIERS[index].tier);
    }
    // Every fee, switch and window changes.
    for (const { tier } of APPROVED_DELIVERY_TIERS) {
      await db.deliveryTierSetting.update({ where: { tier }, data: { fee: 5_000, enabled: false, etaMinMinutes: 1, etaMaxMinutes: 2 } });
    }
    assert.deepEqual(await paidState(paid), asPaid, "paid orders keep their fee, total and tier row exactly");

    // The old checkout still completes as it always did: ₦200 delivery, no tier row, no alert, "Standard delivery".
    const { orderId } = await payments.completeVerifiedPayment(trustedTestVerifiedPayment(legacy));
    const [legacyOrder] = await paidState([orderId!]);
    assert.deepEqual(legacyOrder, { money: { subtotal: 600, deliveryFee: 200, total: 800 }, row: null });
    assert.equal(await deliveryAlerts(admin.userId, orderId!), 0);
    signInAs(legacyStudent);
    const tracked = await callRoute(orderApi.GET, { params: { id: orderId! } });
    assert.equal(tracked.status, 200);
    assert.deepEqual(orderDelivery(tracked), { tier: null, label: "Standard delivery", etaMinMinutes: null, etaMaxMinutes: null, dueAt: null });
  } finally {
    await restoreApprovedDeliveryTiers();
  }
});

test("concurrent completions of an Oya Now! payment create one order and one tier row, with no false alerts", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const { db, payments } = app;
  await restoreApprovedDeliveryTiers();
  const admin = await createTestUser("ADMIN");
  const { products } = await createTestCatalogue([{ name: "Oya pure water", price: 250 }]);
  // Webhook retries and the student's status polling can finalise the same payment at once.
  for (let round = 0; round < 3; round += 1) {
    const student = await createTestUser("STUDENT");
    const attempt = await attemptFor(student, (await cartReady(student, [{ productId: products[0].id, quantity: 1 }])).id, 250, "OYA");
    const verified = trustedTestVerifiedPayment(attempt);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => payments.completeVerifiedPayment(verified)));

    const orders = await db.order.findMany({ where: { userId: student.userId }, select: { id: true } });
    assert.equal(orders.length, 1, `round ${round}: exactly one order`);
    const orderId = orders[0].id;
    const rows = await db.orderDeliveryTier.findMany({ where: { order: { userId: student.userId } }, select: { orderId: true, tier: true } });
    assert.deepEqual(rows, [{ orderId, tier: "OYA" }], `round ${round}: exactly one tier row, on that order`);
    for (const result of results) {
      assert.equal(result.status, "fulfilled", `round ${round}: duplicate completion should be idempotent, got ${result.status === "rejected" ? (result.reason as { code?: string }).code ?? String(result.reason).slice(0, 80) : ""}`);
      if (result.status === "fulfilled") assert.equal(result.value.orderId, orderId);
    }
    assert.deepEqual(await db.payment.findUniqueOrThrow({ where: { id: attempt.id }, select: { status: true, orderId: true } }), { status: "SUCCESS", orderId });
    assert.equal(await db.notification.count({ where: { userId: admin.userId, title: "Payment needs attention", message: { contains: attempt.transactionReference! } } }), 0, `round ${round}: no reconciliation alert`);
    assert.equal(await deliveryAlerts(admin.userId, orderId), 0, `round ${round}: no "Delivery speed not recorded" alert`);
  }
});

test("a damaged tier snapshot still creates the paid order, with no tier row and one alert for admins to dispatch it by hand", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const { db, payments } = app;
  await restoreApprovedDeliveryTiers();
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Damaged snapshot item", price: 900 }]);
  const attempt = await attemptFor(student, (await cartReady(student, [{ productId: products[0].id, quantity: 1 }])).id, 900, "OYA");
  await db.payment.update({ where: { id: attempt.id }, data: { checkoutSnapshot: { ...(await snapshotOf(attempt.id)), deliveryTier: "TURBO" } as Prisma.InputJsonValue } });

  const verified = trustedTestVerifiedPayment(attempt);
  const { orderId } = await payments.completeVerifiedPayment(verified);
  assert.deepEqual(await payments.completeVerifiedPayment(verified), { orderId, alreadyProcessed: true }, "a repeated callback changes nothing");
  // The money matched, so the payment completes normally: it is the speed that can't be read.
  assert.deepEqual(await db.payment.findUniqueOrThrow({ where: { id: attempt.id }, select: { status: true, orderId: true } }), { status: "SUCCESS", orderId });
  assert.deepEqual(await db.order.findUniqueOrThrow({ where: { id: orderId! }, select: { status: true, deliveryFee: true, total: true } }), { status: "FINDING_RUNNER", deliveryFee: 400, total: 1_300 });
  assert.equal(await db.orderDeliveryTier.count({ where: { orderId: orderId! } }), 0);
  assert.deepEqual(
    await db.notification.findMany({ where: { userId: admin.userId, orderId: orderId!, title: "Delivery speed not recorded" }, select: { type: true, message: true } }),
    [{ type: "ORDER", message: `Order ${orderId} was paid with an unreadable delivery speed. Check its payment snapshot and dispatch it by hand.` }],
  );
});

test("before the migration: Cruise Mode only at ₦200, other tiers refused, orders paid without a tier row", { skip }, async (t) => {
  if (await deliveryTierTablesMigrated()) return t.skip("the delivery-tier migration is applied: this test is for a database without it");
  const { db, payments, tiers, orderApi } = app;
  const quotes = await tiers.readDeliveryTierQuotes(db);
  assert.equal(quotes.source, "fallback");
  assert.deepEqual(
    quotes.quotes.map((quote) => [quote.tier, quote.available, quote.fee, quote.settingsVersion]),
    [["CRUISE", true, 200, null], ["SHARP", false, null, null], ["OYA", false, null, null]],
  );

  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Lag-safe bread", price: 600 }]);
  const location = await cartReady(student, [{ productId: products[0].id, quantity: 1 }]);

  // Only Cruise Mode exists: Sharp Sharp is refused with nothing created.
  const sharp = await payUpToProvider(student, { deliveryLocationId: location.id, deliveryTier: "SHARP", reviewedTotal: 900, reviewedDeliveryFee: 300 });
  assert.equal(sharp.status, 409, JSON.stringify(sharp.json));
  assert.equal(sharp.json.code, "DELIVERY_TIER_UNAVAILABLE");
  assert.equal(sharp.json.tier, "SHARP");
  assert.equal(await db.payment.count({ where: { userId: student.userId } }), 0);

  // No tier (an old tab) and Cruise Mode both charge subtotal + ₦200 and record Cruise Mode, with no settings version.
  signInAs(student);
  const oldTab = await payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 800);
  signInAs(student);
  const cruise = await payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 800, { tier: "CRUISE", reviewedDeliveryFee: 200 });
  for (const attempt of [oldTab, cruise]) {
    assert.equal(attempt.amount, 600 + 200);
    assert.deepEqual(await deliveryOf(attempt.id), frozen("CRUISE", null));
  }

  // It completes exactly as before tiers: ₦200 delivery, no reconciliation, no alert, and "Standard delivery".
  const { orderId } = await payments.completeVerifiedPayment(trustedTestVerifiedPayment(cruise));
  assert.deepEqual(await db.order.findUniqueOrThrow({ where: { id: orderId! }, select: { status: true, deliveryFee: true, total: true } }), { status: "FINDING_RUNNER", deliveryFee: 200, total: 800 });
  assert.deepEqual(await db.payment.findUniqueOrThrow({ where: { id: cruise.id }, select: { status: true, orderId: true } }), { status: "SUCCESS", orderId });
  assert.equal(await db.notification.count({ where: { userId: admin.userId, title: "Payment needs attention", message: { contains: cruise.transactionReference! } } }), 0);
  assert.equal(await deliveryAlerts(admin.userId, orderId!), 0);
  signInAs(student);
  const tracked = await callRoute(orderApi.GET, { params: { id: orderId! } });
  assert.equal(tracked.status, 200);
  assert.deepEqual(orderDelivery(tracked), { tier: null, label: "Standard delivery", etaMinMinutes: null, etaMaxMinutes: null, dueAt: null });
});
