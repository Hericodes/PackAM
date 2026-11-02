/**
 * The only code that reads or writes the delivery-tier tables (DeliveryTierSetting, OrderDeliveryTier). Every
 * function works on a database without migration 20261101150000 and then behaves exactly as PackAM did before
 * tiers: Cruise Mode only, at the legacy ₦200 fee, and no tier rows.
 *
 * - A probe (to_regclass) runs first. It never fails, so no failing query is logged or aborts a transaction.
 *   Only "ready" is remembered; while the tables are missing every call probes again, so tiers switch on as soon
 *   as the migration is applied, with no redeploy.
 * - Outside a transaction (readTierTables): try/catch with isSchemaBehindCode, falling back to the legacy value.
 * - Inside an interactive transaction (inTierSavepoint): the work runs in a savepoint (a nested tx.$transaction),
 *   so a failed statement rolls back only the savepoint, never the payment or dispatch transaction. Await it on its
 *   own: never inside Promise.all with other work on the same transaction, and always pass the transaction client.
 *
 * Takes the client as an argument (db or a transaction), like priceCart, and imports neither db nor server-only,
 * so every fallback is unit-tested with fake clients. Don't put error-code words in comments right above a query:
 * outside production Prisma copies nearby source lines into error messages, and isSchemaBehindCode reads messages.
 */
import type { Prisma } from "@prisma/client";
import { DELIVERY_TIER_MIGRATION, isSchemaBehindCode, missingSchemaElement } from "./db-errors";
import { isSerializationFailure } from "./db-retry";
import { URGENT_TIERS, fallbackQuoteSet, quotesFromRows, type DeliveryTierCode, type DeliveryTierQuoteSet } from "./delivery-tiers";

type Tx = Prisma.TransactionClient;
type ProbeClient = Pick<Tx, "$queryRaw">;
type SavepointClient = Pick<Tx, "$queryRaw" | "$transaction">;

let tablesReady = false;
let reportedMissing = false;

function reportMissingOnce(what: string) {
  if (reportedMissing) return;
  reportedMissing = true;
  console.error(`SCHEMA BEHIND CODE in delivery tiers: the database is missing ${what}. Checkout offers Cruise Mode only and orders get no tier until migration ${DELIVERY_TIER_MIGRATION} is applied (npx prisma migrate deploy).`);
}

/** True once both tier tables exist. Safe inside a transaction: to_regclass returns NULL instead of failing. */
export async function deliveryTierTablesReady(client: ProbeClient): Promise<boolean> {
  if (tablesReady) return true;
  const rows = await client.$queryRaw<Array<{ ready: boolean | null }>>`SELECT (to_regclass('public."DeliveryTierSetting"') IS NOT NULL AND to_regclass('public."OrderDeliveryTier"') IS NOT NULL) AS "ready"`;
  tablesReady = rows[0]?.ready === true;
  if (!tablesReady) reportMissingOnce("the delivery-tier tables");
  return tablesReady;
}

/** A tier query hit schema lag although the probe said ready (e.g. the migration was rolled back): probe again. */
export function noteTierSchemaMissing(error: unknown, where: string) {
  tablesReady = false;
  reportMissingOnce(`${missingSchemaElement(error)} (${where})`);
}

/** Tests only: forget the probe result and the log-once flag. */
export function resetDeliveryTierProbe() {
  tablesReady = false;
  reportedMissing = false;
}

/** Outside a transaction: run `work`, or return `legacy` when the tier tables are missing. */
export async function readTierTables<C extends ProbeClient, T>(client: C, work: (client: C) => Promise<T>, legacy: T, where: string): Promise<T> {
  if (!(await deliveryTierTablesReady(client))) return legacy;
  try {
    return await work(client);
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    noteTierSchemaMissing(error, where);
    return legacy;
  }
}

/** Inside an interactive transaction: run `work` in a savepoint, or return `legacy` when the tier tables are missing. */
export async function inTierSavepoint<T>(tx: SavepointClient, work: (savepoint: Tx) => Promise<T>, legacy: T, where: string): Promise<T> {
  if (!(await deliveryTierTablesReady(tx))) return legacy;
  try {
    return await tx.$transaction(work);
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    noteTierSchemaMissing(error, where);
    return legacy;
  }
}

const SETTINGS_SELECT = { tier: true, fee: true, enabled: true, etaMinMinutes: true, etaMaxMinutes: true, version: true } as const;

/** Checkout, food and product pages: the current quotes, or the Cruise-only fallback. Never rejects for schema lag. */
export function readDeliveryTierQuotes(client: Pick<Tx, "$queryRaw" | "deliveryTierSetting">): Promise<DeliveryTierQuoteSet> {
  return readTierTables(client, async (c) => quotesFromRows(await c.deliveryTierSetting.findMany({ select: SETTINGS_SELECT })), fallbackQuoteSet(), "quotes");
}

/** createPaymentAttempt: the same, inside its serializable transaction. */
export function readDeliveryTierQuotesInTransaction(tx: SavepointClient): Promise<DeliveryTierQuoteSet> {
  return inTierSavepoint(tx, async (savepoint) => quotesFromRows(await savepoint.deliveryTierSetting.findMany({ select: SETTINGS_SELECT })), fallbackQuoteSet(), "payment quote");
}

export type OrderDeliveryTierRow = {
  orderId: string;
  tier: DeliveryTierCode;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  dueAt: Date;
  escalatedAt: Date | null;
  createdAt: Date;
};

const ORDER_TIER_SELECT = { orderId: true, tier: true, etaMinMinutes: true, etaMaxMinutes: true, dueAt: true, escalatedAt: true, createdAt: true } as const;

/** Order pages, lists and runner missions: tier rows by order id. A missing entry means "Standard delivery". */
export async function loadOrderDeliveryTiers(client: Pick<Tx, "$queryRaw" | "orderDeliveryTier">, orderIds: readonly string[]): Promise<Map<string, OrderDeliveryTierRow>> {
  const ids = [...new Set(orderIds)];
  if (!ids.length) return new Map();
  return readTierTables(client, async (c) => {
    const rows = await c.orderDeliveryTier.findMany({ where: { orderId: { in: ids } }, select: ORDER_TIER_SELECT });
    return new Map(rows.map((row) => [row.orderId, row as OrderDeliveryTierRow]));
  }, new Map<string, OrderDeliveryTierRow>(), "order tiers");
}

/** Dispatch and acceptance: one order's tier row inside the transaction, or null. */
export function orderDeliveryTierInTransaction(tx: SavepointClient, orderId: string): Promise<OrderDeliveryTierRow | null> {
  return inTierSavepoint(tx, async (savepoint) => (await savepoint.orderDeliveryTier.findUnique({ where: { orderId }, select: ORDER_TIER_SELECT })) as OrderDeliveryTierRow | null, null, "order tier");
}

export type OrderDeliveryTierInput = { orderId: string; tier: DeliveryTierCode; etaMinMinutes: number; etaMaxMinutes: number; dueAt: Date; settingsVersion: number | null };

/**
 * completeVerifiedPayment: freeze the paid tier onto the new order. Returns false when no row was written
 * (tables missing, or the insert failed and was rolled back to its savepoint); the caller then alerts admins for an
 * urgent tier. A serialization failure is rethrown so the payment transaction's retry handles it. Never blocks the order.
 */
export async function writeOrderDeliveryTierInTransaction(tx: SavepointClient, data: OrderDeliveryTierInput): Promise<boolean> {
  if (!(await deliveryTierTablesReady(tx))) return false;
  try {
    await tx.$transaction((savepoint) => savepoint.orderDeliveryTier.create({ data, select: { orderId: true } }));
    return true;
  } catch (error) {
    if (isSerializationFailure(error)) throw error;
    if (isSchemaBehindCode(error)) noteTierSchemaMissing(error, "order tier write");
    else console.error("ORDER DELIVERY TIER WRITE ERROR:", error instanceof Error ? error.name : "Unknown error", error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "");
    return false;
  }
}

/** Dispatch: mark an urgent order escalated. True for exactly one caller, however many passes race. */
export function claimUrgentEscalationInTransaction(tx: SavepointClient, orderId: string, now: Date): Promise<boolean> {
  return inTierSavepoint(tx, async (savepoint) => (await savepoint.orderDeliveryTier.updateMany({
    where: { orderId, escalatedAt: null, tier: { in: [...URGENT_TIERS] } },
    data: { escalatedAt: now },
  })).count === 1, false, "escalation");
}

export type RunnerMissionLoad = { activeMissions: number; holdsUrgent: boolean };

/** A runner's accepted, unfinished missions (orders and print jobs) and whether one of them is Oya Now! or Sharp Sharp. */
export async function runnerMissionLoadInTransaction(tx: Pick<Tx, "$queryRaw" | "$transaction" | "runnerAssignment">, runnerId: string): Promise<RunnerMissionLoad> {
  const accepted = await tx.runnerAssignment.findMany({ where: { runnerId, status: "ACCEPTED" }, select: { orderId: true } });
  const orderIds = accepted.flatMap((assignment) => (assignment.orderId ? [assignment.orderId] : []));
  const urgent = orderIds.length
    ? await inTierSavepoint(tx, (savepoint) => savepoint.orderDeliveryTier.count({ where: { orderId: { in: orderIds }, tier: { in: [...URGENT_TIERS] } } }), 0, "runner load")
    : 0;
  return { activeMissions: accepted.length, holdsUrgent: urgent > 0 };
}

/** The same outside a transaction (mission detail hints). */
export async function runnerMissionLoad(client: Pick<Tx, "$queryRaw" | "runnerAssignment" | "orderDeliveryTier">, runnerId: string): Promise<RunnerMissionLoad> {
  const accepted = await client.runnerAssignment.findMany({ where: { runnerId, status: "ACCEPTED" }, select: { orderId: true } });
  const orderIds = accepted.flatMap((assignment) => (assignment.orderId ? [assignment.orderId] : []));
  const urgent = orderIds.length
    ? await readTierTables(client, (c) => c.orderDeliveryTier.count({ where: { orderId: { in: orderIds }, tier: { in: [...URGENT_TIERS] } } }), 0, "runner load")
    : 0;
  return { activeMissions: accepted.length, holdsUrgent: urgent > 0 };
}
