import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  claimUrgentEscalationInTransaction, deliveryTierTablesReady, inTierSavepoint, loadOrderDeliveryTiers, readDeliveryTierQuotes,
  readDeliveryTierQuotesInTransaction, resetDeliveryTierProbe, runnerMissionLoadInTransaction, writeOrderDeliveryTierInTransaction,
} from "./delivery-tier-store";

/** The Prisma 7 + adapter-pg shape for a missing table (db-errors.test.ts), for the tier tables. */
const missingTable = (table: string) => Object.assign(new Error("Invalid `prisma.deliveryTierSetting.findMany()` invocation"), {
  name: "PrismaClientKnownRequestError",
  code: "P2021",
  meta: { modelName: table, driverAdapterError: { name: "DriverAdapterError", cause: { originalCode: "42P01", originalMessage: `relation "public.${table}" does not exist`, kind: "TableDoesNotExist", table: `public.${table}` } } },
});
const coded = (code: string) => Object.assign(new Error(code), { name: "PrismaClientKnownRequestError", code });
const APPROVED = [
  { tier: "CRUISE", fee: 200, enabled: true, etaMinMinutes: 20, etaMaxMinutes: 30, version: 1 },
  { tier: "SHARP", fee: 300, enabled: true, etaMinMinutes: 15, etaMaxMinutes: 25, version: 1 },
  { tier: "OYA", fee: 400, enabled: true, etaMinMinutes: 10, etaMaxMinutes: 15, version: 1 },
];

type Fake = Record<string, unknown> & { probes: number; savepoints: number };
function fakeClient(options: { ready: boolean; delegates?: Record<string, Record<string, (...args: unknown[]) => unknown>> }): Fake {
  const client: Fake = {
    probes: 0,
    savepoints: 0,
    $queryRaw: async () => { client.probes += 1; return [{ ready: options.ready }]; },
    ...options.delegates,
  };
  // A savepoint runs the work against the same fake; a throw inside it is what Prisma rethrows after ROLLBACK TO SAVEPOINT.
  client.$transaction = async (work: (savepoint: unknown) => Promise<unknown>) => { client.savepoints += 1; return work(client); };
  return client;
}
const untouchable = new Proxy({}, { get: () => () => { throw new Error("must not be queried"); } }) as Record<string, (...args: unknown[]) => unknown>;
let errors: string[] = [];
const originalError = console.error;
beforeEach(() => { resetDeliveryTierProbe(); errors = []; console.error = (...args: unknown[]) => { errors.push(args.join(" ")); }; });
afterEach(() => { console.error = originalError; });

test("without the tables: Cruise-only quotes, no tier query at all, one log line naming the migration", async () => {
  const client = fakeClient({ ready: false, delegates: { deliveryTierSetting: untouchable } });
  for (let i = 0; i < 3; i += 1) {
    const set = await readDeliveryTierQuotes(client as never);
    assert.equal(set.source, "fallback");
    assert.deepEqual(set.quotes.filter((q) => q.available).map((q) => [q.tier, q.fee]), [["CRUISE", 200]]);
  }
  assert.equal(client.probes, 3, "a missing table is never remembered: the migration is picked up without a redeploy");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /20261101150000_delivery_tiers/);
});

test("with the tables: quotes come from the rows, and the probe result is remembered", async () => {
  const client = fakeClient({ ready: true, delegates: { deliveryTierSetting: { findMany: async () => APPROVED } } });
  const first = await readDeliveryTierQuotes(client as never);
  await readDeliveryTierQuotes(client as never);
  assert.equal(first.source, "settings");
  assert.deepEqual(first.quotes.map((q) => [q.tier, q.fee, q.available]), [["CRUISE", 200, true], ["SHARP", 300, true], ["OYA", 400, true]]);
  assert.equal(client.probes, 1);
});

test("schema lag after a ready probe (rolled-back migration): fallback, and the next call probes again", async () => {
  const client = fakeClient({ ready: true, delegates: { deliveryTierSetting: { findMany: async () => { throw missingTable("DeliveryTierSetting"); } } } });
  assert.equal((await readDeliveryTierQuotes(client as never)).source, "fallback");
  await readDeliveryTierQuotes(client as never);
  assert.equal(client.probes, 2);
  assert.match(errors[0], /public\.DeliveryTierSetting/);
});

test("other database errors are never mistaken for schema lag", async () => {
  for (const error of [coded("P1001"), coded("P2002"), coded("P2034"), new Error("timeout")]) {
    resetDeliveryTierProbe();
    const client = fakeClient({ ready: true, delegates: { deliveryTierSetting: { findMany: async () => { throw error; } } } });
    await assert.rejects(readDeliveryTierQuotes(client as never), (thrown) => thrown === error);
  }
});

test("inside a transaction the read runs in a savepoint and falls back on schema lag", async () => {
  const lagging = fakeClient({ ready: true, delegates: { deliveryTierSetting: { findMany: async () => { throw missingTable("DeliveryTierSetting"); } } } });
  assert.equal((await readDeliveryTierQuotesInTransaction(lagging as never)).source, "fallback");
  assert.equal(lagging.savepoints, 1);
  resetDeliveryTierProbe();
  const ready = fakeClient({ ready: true, delegates: { deliveryTierSetting: { findMany: async () => APPROVED } } });
  assert.equal((await readDeliveryTierQuotesInTransaction(ready as never)).source, "settings");
  resetDeliveryTierProbe();
  const missing = fakeClient({ ready: false, delegates: { deliveryTierSetting: untouchable } });
  assert.equal((await readDeliveryTierQuotesInTransaction(missing as never)).source, "fallback");
  assert.equal(missing.savepoints, 0, "no savepoint when the probe says the tables are missing");
  resetDeliveryTierProbe();
  const conflict = coded("P2034");
  await assert.rejects(inTierSavepoint(fakeClient({ ready: true }) as never, async () => { throw conflict; }, "legacy", "test"), (thrown) => thrown === conflict, "serialization failures reach the retry");
});

test("the paid order's tier row: written in a savepoint; skipped (false) when it can't be; conflicts rethrown", async () => {
  const data = { orderId: "o1", tier: "OYA" as const, etaMinMinutes: 10, etaMaxMinutes: 15, dueAt: new Date("2026-11-02T10:15:00Z"), settingsVersion: 1 };
  const written: unknown[] = [];
  const ok = fakeClient({ ready: true, delegates: { orderDeliveryTier: { create: async (args: unknown) => { written.push(args); return { orderId: "o1" }; } } } });
  assert.equal(await writeOrderDeliveryTierInTransaction(ok as never, data), true);
  assert.deepEqual(written, [{ data, select: { orderId: true } }]);
  resetDeliveryTierProbe();
  assert.equal(await writeOrderDeliveryTierInTransaction(fakeClient({ ready: false, delegates: { orderDeliveryTier: untouchable } }) as never, data), false);
  resetDeliveryTierProbe();
  assert.equal(await writeOrderDeliveryTierInTransaction(fakeClient({ ready: true, delegates: { orderDeliveryTier: { create: async () => { throw missingTable("OrderDeliveryTier"); } } } }) as never, data), false);
  resetDeliveryTierProbe();
  assert.equal(await writeOrderDeliveryTierInTransaction(fakeClient({ ready: true, delegates: { orderDeliveryTier: { create: async () => { throw coded("P2002"); } } } }) as never, data), false, "any failed insert leaves the order intact");
  resetDeliveryTierProbe();
  const conflict = coded("P2034");
  await assert.rejects(writeOrderDeliveryTierInTransaction(fakeClient({ ready: true, delegates: { orderDeliveryTier: { create: async () => { throw conflict; } } } }) as never, data), (thrown) => thrown === conflict);
});

test("order tiers for display: none requested, none queried; missing tables mean Standard delivery for all", async () => {
  const neverProbed = fakeClient({ ready: true });
  assert.equal((await loadOrderDeliveryTiers(neverProbed as never, [])).size, 0);
  assert.equal(neverProbed.probes, 0);
  const missing = fakeClient({ ready: false, delegates: { orderDeliveryTier: untouchable } });
  assert.equal((await loadOrderDeliveryTiers(missing as never, ["o1", "o2"])).size, 0);
  resetDeliveryTierProbe();
  const row = { orderId: "o2", tier: "SHARP", etaMinMinutes: 15, etaMaxMinutes: 25, dueAt: new Date(), escalatedAt: null, createdAt: new Date() };
  const ready = fakeClient({ ready: true, delegates: { orderDeliveryTier: { findMany: async () => [row] } } });
  const map = await loadOrderDeliveryTiers(ready as never, ["o1", "o2", "o2"]);
  assert.deepEqual([...map.keys()], ["o2"]);
});

test("escalation claim and runner load", async () => {
  const claimed = fakeClient({ ready: true, delegates: { orderDeliveryTier: { updateMany: async () => ({ count: 1 }) } } });
  assert.equal(await claimUrgentEscalationInTransaction(claimed as never, "o1", new Date()), true);
  const lost = fakeClient({ ready: true, delegates: { orderDeliveryTier: { updateMany: async () => ({ count: 0 }) } } });
  assert.equal(await claimUrgentEscalationInTransaction(lost as never, "o1", new Date()), false);
  const load = fakeClient({ ready: true, delegates: {
    runnerAssignment: { findMany: async () => [{ orderId: "o1" }, { orderId: null }] },
    orderDeliveryTier: { count: async () => 1 },
  } });
  assert.deepEqual(await runnerMissionLoadInTransaction(load as never, "r1"), { activeMissions: 2, holdsUrgent: true });
  resetDeliveryTierProbe();
  const legacy = fakeClient({ ready: false, delegates: { runnerAssignment: { findMany: async () => [{ orderId: "o1" }] }, orderDeliveryTier: untouchable } });
  assert.deepEqual(await runnerMissionLoadInTransaction(legacy as never, "r1"), { activeMissions: 1, holdsUrgent: false }, "before the migration no order is urgent");
});

test("the probe SQL quotes the mixed-case table names (unquoted, to_regclass folds them to lowercase and never matches)", async () => {
  let sql = "";
  const client = { $queryRaw: async (strings: TemplateStringsArray) => { sql = strings.join("?"); return [{ ready: false }]; } };
  await deliveryTierTablesReady(client as never);
  assert.match(sql, /to_regclass\('public\."DeliveryTierSetting"'\)/);
  assert.match(sql, /to_regclass\('public\."OrderDeliveryTier"'\)/);
});
