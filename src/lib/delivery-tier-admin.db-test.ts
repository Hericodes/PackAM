/**
 * Admin → Delivery tiers against a disposable database, through the real route: a price or switch change is saved,
 * versioned and audited, and checkout sees it at once; a tier can never be on without a fee (API and database);
 * stale and unchanged saves write nothing; at least one tier stays on even when admins race; only admins, with
 * same-site JSON requests. The last test runs only on a database WITHOUT the tier migration.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules). The settings rows are global
 * and cleanup never touches them, so every test that edits them restores the approved values afterwards.
 */
import {
  APPROVED_DELIVERY_TIERS, callRoute, cleanupTestData, createTestUser, dbTestSkip as skip, deliveryTierTablesMigrated,
  restoreApprovedDeliveryTiers, signInAs, testDb,
} from "../test-support/db-harness";
import assert from "node:assert/strict";
import { after, before, test, type TestContext } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  route: typeof import("../app/api/admin/delivery-tiers/route");
  admin: typeof import("./delivery-tier-admin");
  input: typeof import("./delivery-tier-admin-input");
  store: typeof import("./delivery-tier-store");
  tiers: typeof import("./delivery-tiers");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [route, admin, input, store, tiers] = await Promise.all([
    import("../app/api/admin/delivery-tiers/route"),
    import("./delivery-tier-admin"),
    import("./delivery-tier-admin-input"),
    import("./delivery-tier-store"),
    import("./delivery-tiers"),
  ]);
  app = { db, route, admin, input, store, tiers };
});
after(async () => {
  try {
    if (!skip) await restoreApprovedDeliveryTiers();
  } finally {
    await cleanupTestData();
  }
});

type User = Awaited<ReturnType<typeof createTestUser>>;
type Tier = "CRUISE" | "SHARP" | "OYA";

function patch(user: User | null, body: Record<string, unknown> | undefined, headers?: Record<string, string>) {
  signInAs(user);
  return callRoute(app.route.PATCH, { method: "PATCH", path: "/api/admin/delivery-tiers", body, headers });
}

function setting(tier: Tier) {
  return app.db.deliveryTierSetting.findUniqueOrThrow({ where: { tier }, select: { tier: true, fee: true, enabled: true, version: true, etaMinMinutes: true, etaMaxMinutes: true } });
}

function tierAudits(actorId: string) {
  return app.db.auditLog.findMany({ where: { actorId, action: "DELIVERY_TIER_UPDATED" }, orderBy: { createdAt: "asc" } });
}

/** Tier tests need the migration; they start from the approved configuration whatever an earlier run left behind. */
async function migrated(t: TestContext) {
  if (!(await deliveryTierTablesMigrated())) {
    t.skip("delivery-tier migration not applied to this test database");
    return false;
  }
  await restoreApprovedDeliveryTiers();
  return true;
}

test("the admin view lists the three seeded tiers in display order with prices, windows and statuses", { skip }, async (t) => {
  if (!(await migrated(t))) return;
  const view = await app.admin.loadDeliveryTierAdminView();
  assert.equal(view.ready, true);
  assert.deepEqual(view.tiers.map((card) => [card.tier, card.label, card.fee, card.eta, card.enabled]), [
    ["CRUISE", "Cruise Mode", 200, "20–30 minutes", true],
    ["SHARP", "Sharp Sharp", 300, "15–25 minutes", true],
    ["OYA", "Oya Now!", 400, "10–15 minutes", true],
  ]);
  for (const card of view.tiers) {
    const row = await setting(card.tier);
    const approved = APPROVED_DELIVERY_TIERS.find((candidate) => candidate.tier === card.tier)!;
    assert.deepEqual([row.fee, row.enabled, row.etaMinMinutes, row.etaMaxMinutes], [approved.fee, approved.enabled, approved.etaMinMinutes, approved.etaMaxMinutes]);
    assert.equal(card.version, row.version, "the card carries the row's edit version");
    assert.equal(card.description, app.tiers.DELIVERY_TIER_DESCRIPTIONS[card.tier]);
    assert.ok(card.updatedAtLabel, "last changed time shown");
  }
});

test("an admin price change is saved, versioned and audited with the admin, time and before/after; checkout sees it at once", { skip }, async (t) => {
  if (!(await migrated(t))) return;
  const admin = await createTestUser("ADMIN");
  try {
    const before = await setting("SHARP");
    const startedAt = Date.now();
    const saved = await patch(admin, { tier: "SHARP", version: before.version, fee: 350, etaMinMinutes: 1, etaMaxMinutes: 2, description: "ignored" });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.changed, true);
    const row = saved.json.tier as Record<string, unknown>;
    assert.deepEqual({ ...row, updatedAt: undefined }, { tier: "SHARP", fee: 350, enabled: true, etaMinMinutes: 15, etaMaxMinutes: 25, version: before.version + 1, updatedAt: undefined }, "windows can't be changed here");
    assert.deepEqual(await setting("SHARP"), { tier: "SHARP", fee: 350, enabled: true, version: before.version + 1, etaMinMinutes: 15, etaMaxMinutes: 25 });

    const audits = await tierAudits(admin.userId);
    assert.equal(audits.length, 1, "exactly one audit row");
    const [audit] = audits;
    assert.deepEqual(
      { actorId: audit.actorId, resource: audit.resource, resourceId: audit.resourceId, previousState: audit.previousState, newState: audit.newState, details: audit.details },
      { actorId: admin.userId, resource: "DeliveryTierSetting", resourceId: "SHARP", previousState: { fee: 300, enabled: true }, newState: { fee: 350, enabled: true }, details: "Sharp Sharp: ₦300 → ₦350" },
    );
    assert.ok(audit.createdAt.getTime() >= startedAt - 5_000 && audit.createdAt.getTime() <= Date.now() + 5_000, "the audit row is timestamped");

    const quote = app.tiers.quoteFor(await app.store.readDeliveryTierQuotes(app.db), "SHARP");
    assert.deepEqual([quote.fee, quote.available, quote.settingsVersion], [350, true, before.version + 1], "the next checkout is quoted the new price");

    const view = await app.admin.loadDeliveryTierAdminView();
    assert.deepEqual(view.tiers.find((card) => card.tier === "SHARP")?.fee, 350);
    const entry = view.history.find((candidate) => candidate.id === audit.id);
    assert.ok(entry, "the change is in the page's history");
    assert.deepEqual([entry.summary, entry.before, entry.after, entry.adminEmail], ["Sharp Sharp: ₦300 → ₦350", "₦300 · Enabled", "₦350 · Enabled", (await app.db.user.findUniqueOrThrow({ where: { id: admin.userId } })).email]);
    assert.ok(entry.atLabel.length > 0);

    const off = await patch(admin, { tier: "SHARP", version: before.version + 1, enabled: false });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    const [, second] = await tierAudits(admin.userId);
    assert.deepEqual([second.previousState, second.newState, second.details], [{ fee: 350, enabled: true }, { fee: 350, enabled: false }, "Sharp Sharp: on → off"], "a switch change is audited with the status before and after");
    assert.equal(app.tiers.quoteFor(await app.store.readDeliveryTierQuotes(app.db), "SHARP").available, false);
  } finally {
    await restoreApprovedDeliveryTiers();
  }
});

test("a tier can't be turned on without a valid fee, through the API or directly in the database", { skip }, async (t) => {
  if (!(await migrated(t))) return;
  const admin = await createTestUser("ADMIN");
  try {
    const oya = await setting("OYA");
    const onWithoutFee = await patch(admin, { tier: "OYA", version: oya.version, fee: null, enabled: true });
    assert.equal(onWithoutFee.status, 400);
    assert.deepEqual(onWithoutFee.json, { error: "Set a fee of at least ₦1 before turning Oya Now! on.", code: "FEE_REQUIRED" });
    const clearsFeeWhileOn = await patch(admin, { tier: "OYA", version: oya.version, fee: null });
    assert.equal(clearsFeeWhileOn.json.code, "FEE_REQUIRED", "clearing the fee of a tier that is on is the same thing");
    for (const fee of [0, -1, 12.5, 100_001, "400"]) {
      const bad = await patch(admin, { tier: "OYA", version: oya.version, fee, enabled: true });
      assert.equal(bad.status, 400, String(fee));
      assert.deepEqual(bad.json, { error: "Set the fee in whole naira, from ₦1 to ₦100,000.", code: "INVALID_REQUEST", fields: { fee: "Set the fee in whole naira, from ₦1 to ₦100,000." } }, String(fee));
    }
    assert.deepEqual(await setting("OYA"), oya, "nothing was changed");
    assert.equal((await tierAudits(admin.userId)).length, 0, "nothing was audited");

    // Off with no fee is allowed; switching it back on still needs a fee.
    const off = await patch(admin, { tier: "OYA", version: oya.version, fee: null, enabled: false });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    const unpriced = await setting("OYA");
    assert.deepEqual([unpriced.fee, unpriced.enabled], [null, false]);
    const on = await patch(admin, { tier: "OYA", version: unpriced.version, enabled: true });
    assert.equal(on.json.code, "FEE_REQUIRED");
    assert.equal(app.tiers.quoteFor(await app.store.readDeliveryTierQuotes(app.db), "OYA").available, false);

    // The database refuses it even when the API is bypassed, and the API would recognise that refusal.
    let refusal: unknown = null;
    try {
      await app.db.deliveryTierSetting.update({ where: { tier: "OYA" }, data: { enabled: true } });
    } catch (error) {
      refusal = error;
    }
    assert.match(String(refusal), /DeliveryTierSetting_enabled_requires_fee_check|check constraint/i);
    assert.equal(app.input.isCheckViolation(refusal), true, "isCheckViolation matches the real driver-adapter error");
    await restoreApprovedDeliveryTiers();
    await assert.rejects(app.db.deliveryTierSetting.update({ where: { tier: "OYA" }, data: { fee: null } }), /DeliveryTierSetting_enabled_requires_fee_check|check constraint/i);
    await assert.rejects(app.db.deliveryTierSetting.update({ where: { tier: "OYA" }, data: { fee: 0 } }), /DeliveryTierSetting_fee_check|check constraint/i);
    assert.deepEqual([(await setting("OYA")).fee, (await setting("OYA")).enabled], [400, true]);
  } finally {
    await restoreApprovedDeliveryTiers();
  }
});

test("stale edits are refused and an unchanged save writes nothing", { skip }, async (t) => {
  if (!(await migrated(t))) return;
  const [first, second] = [await createTestUser("ADMIN"), await createTestUser("ADMIN")];
  try {
    const sharp = await setting("SHARP");
    assert.equal((await patch(first, { tier: "SHARP", version: sharp.version, fee: 320, enabled: true })).status, 200);

    const stale = await patch(second, { tier: "SHARP", version: sharp.version, fee: 330, enabled: true });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.json, { error: "Someone changed this tier while you were editing it. The page now shows the latest values.", code: "TIER_CHANGED" });
    assert.equal((await setting("SHARP")).fee, 320, "the newer value is kept");

    const same = await patch(first, { tier: "SHARP", version: sharp.version + 1, fee: 320, enabled: true });
    assert.equal(same.status, 200);
    assert.equal(same.json.changed, false);
    assert.equal((await setting("SHARP")).version, sharp.version + 1, "no version bump");
    assert.equal((await tierAudits(first.userId)).length, 1, "no audit row for a save that changed nothing");
    assert.equal((await tierAudits(second.userId)).length, 0);

    const missing = await patch(first, { tier: "SHARP", version: sharp.version + 99, enabled: false });
    assert.equal(missing.json.code, "TIER_CHANGED", "a version from the future is stale too");
  } finally {
    await restoreApprovedDeliveryTiers();
  }
});

test("at least one tier stays on, even when two admins turn tiers off at once", { skip }, async (t) => {
  if (!(await migrated(t))) return;
  const ROUNDS = 10;
  const [first, second] = [await createTestUser("ADMIN"), await createTestUser("ADMIN")];
  try {
    // Several rounds: the second admin's conflict shows up at different points (a query, or COMMIT itself).
    for (let round = 1; round <= ROUNDS; round += 1) {
      await restoreApprovedDeliveryTiers();
      await app.db.deliveryTierSetting.update({ where: { tier: "OYA" }, data: { enabled: false } });
      const [cruise, sharp] = [await setting("CRUISE"), await setting("SHARP")];
      const results = await Promise.all([
        patch(first, { tier: "CRUISE", version: cruise.version, enabled: false }),
        patch(second, { tier: "SHARP", version: sharp.version, enabled: false }),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409], `round ${round}: ${JSON.stringify(results.map((result) => result.json))}`);
      const refused = results.find((result) => result.status === 409)!;
      assert.equal(refused.json.code, "LAST_ENABLED_TIER");
      assert.match(String(refused.json.error), /is the only delivery speed on\. Turn another one on first, so students can always check out\./);
      assert.equal(await app.db.deliveryTierSetting.count({ where: { enabled: true } }), 1, `round ${round}: exactly one tier is still on`);
    }
    assert.equal((await tierAudits(first.userId)).length + (await tierAudits(second.userId)).length, ROUNDS, "one audit row per change that was saved");
  } finally {
    await restoreApprovedDeliveryTiers();
  }
});

test("only admins, with same-site JSON requests, can change a tier", { skip }, async () => {
  const tablesReady = await deliveryTierTablesMigrated();
  if (tablesReady) await restoreApprovedDeliveryTiers();
  const [admin, student, runner] = [await createTestUser("ADMIN"), await createTestUser("STUDENT"), await createTestUser("RUNNER")];
  const before = tablesReady ? await setting("SHARP") : null;
  const body = { tier: "SHARP", version: before?.version ?? 1, fee: 999, enabled: true };

  const anonymous = await patch(null, body);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.json.code, "SIGN_IN_REQUIRED");
  for (const user of [student, runner]) assert.equal((await patch(user, body)).status, 403, user.role);
  const otherSites: Array<Record<string, string>> = [{ Origin: "https://evil.test" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }];
  for (const headers of otherSites) {
    const crossSite = await patch(admin, body, headers);
    assert.equal(crossSite.status, 403, JSON.stringify(headers));
    assert.equal(crossSite.json.code, "CROSS_SITE_REQUEST");
  }
  const notJson = await patch(admin, body, { "Content-Type": "text/plain;charset=UTF-8" });
  assert.equal(notJson.status, 415);
  assert.equal(notJson.json.code, "JSON_REQUIRED");

  // PackAM's own page passes the guards; these bodies are then refused by validation, still with nothing written.
  const sameOrigin = { Origin: "http://packam.test", "Sec-Fetch-Site": "same-origin" };
  const unreadable = await patch(admin, undefined, sameOrigin);
  assert.deepEqual([unreadable.status, unreadable.json.code], [400, "INVALID_REQUEST"]);
  const unknownTier = await patch(admin, { tier: "TURBO", version: 1, fee: 999 }, sameOrigin);
  assert.deepEqual([unknownTier.status, unknownTier.json.fields], [400, { tier: "Choose a delivery tier." }]);

  if (before) assert.deepEqual(await setting("SHARP"), before, "nothing was changed");
  for (const user of [admin, student, runner]) assert.equal((await tierAudits(user.userId)).length, 0);
});

test("before the migration the page explains and edits are refused with nothing written", { skip }, async (t) => {
  if (await deliveryTierTablesMigrated()) return t.skip("runs only on a database without the delivery-tier migration");
  const admin = await createTestUser("ADMIN");
  const view = await app.admin.loadDeliveryTierAdminView();
  assert.equal(view.ready, false);
  assert.deepEqual(view.tiers.map((card) => [card.tier, card.fee, card.enabled, card.eta, card.version]), [
    ["CRUISE", 200, true, "20–30 minutes", null],
    ["SHARP", null, false, "15–25 minutes", null],
    ["OYA", null, false, "10–15 minutes", null],
  ], "the fallback checkout offers: Cruise Mode only, nothing editable");

  const refused = await patch(admin, { tier: "SHARP", version: 1, fee: 350, enabled: true });
  assert.equal(refused.status, 503);
  assert.deepEqual(refused.json, { ...app.admin.DELIVERY_TIERS_NOT_READY });
  assert.match(String(refused.json.error), /activates after the database update \(migration 20261101150000_delivery_tiers is pending\)\. Nothing was changed\./);
  assert.deepEqual(await app.admin.updateDeliveryTierSetting(admin.userId, { tier: "CRUISE", version: 1, enabled: false }), { status: 503, body: { ...app.admin.DELIVERY_TIERS_NOT_READY } });
  assert.equal(await app.db.auditLog.count({ where: { actorId: admin.userId } }), 0, "no audit row");
  assert.equal(app.tiers.quoteFor(await app.store.readDeliveryTierQuotes(app.db), "SHARP").available, false, "checkout still offers Cruise Mode only");
});
