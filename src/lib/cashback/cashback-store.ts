/**
 * The only code that reads or writes the cashback tables (CashbackSettings, CashbackEntry). Everything here works on
 * a database without migration 20261112090000_cashback: balances read as unavailable, nothing is earned, checkout
 * doesn't offer cashback, and admin changes are refused with an explanation.
 *
 * - A probe (to_regclass) runs first. It never fails, so it can't abort a transaction. Only "ready" is remembered.
 * - Earning runs inside the delivery's transaction, in a savepoint (tx.$transaction): it can never fail a delivery.
 * - Spending is part of the payment's own transaction: if it can't be recorded, nothing is created.
 *
 * Takes the client as an argument and imports neither db nor server-only, so the fallbacks are unit-tested.
 */
import type { Prisma } from "@prisma/client";
import { isSchemaBehindCode, missingSchemaElement } from "../db-errors";
import { isSerializationFailure } from "../db-retry";
import { DEFAULT_CASHBACK_SETTINGS, cashbackEarned, type CashbackKindCode, type CashbackSettingsValue } from "./cashback-rules";

export const CASHBACK_MIGRATION = "20261112090000_cashback";

type Tx = Prisma.TransactionClient;
type ProbeClient = Pick<Tx, "$queryRaw">;

let tablesReady = false;
let reportedMissing = false;

function reportMissingOnce(what: string) {
  if (reportedMissing) return;
  reportedMissing = true;
  console.error(`SCHEMA BEHIND CODE in cashback: the database is missing ${what}. Cashback is unavailable until migration ${CASHBACK_MIGRATION} is applied (npx prisma migrate deploy).`);
}

/** True once the cashback tables exist. Safe inside a transaction: to_regclass returns NULL instead of failing. */
export async function cashbackTablesReady(client: ProbeClient): Promise<boolean> {
  if (tablesReady) return true;
  const rows = await client.$queryRaw<Array<{ ready: boolean | null }>>`SELECT (to_regclass('public."CashbackEntry"') IS NOT NULL AND to_regclass('public."CashbackSettings"') IS NOT NULL) AS "ready"`;
  tablesReady = rows[0]?.ready === true;
  if (!tablesReady) reportMissingOnce("the cashback tables");
  return tablesReady;
}

/** A cashback query hit schema lag although the probe said ready: probe again next time. */
export function noteCashbackSchemaMissing(error: unknown, where: string) {
  tablesReady = false;
  reportMissingOnce(`${missingSchemaElement(error)} (${where})`);
}

/** Tests only: forget the probe result and the log-once flag. */
export function resetCashbackProbe() {
  tablesReady = false;
  reportedMissing = false;
}

/**
 * A student's balance: every entry, except SPENT ones whose payment didn't go through (failed, cancelled or
 * refunded). Cashback held by a payment still being paid or confirmed stays spent until that payment closes.
 */
export async function cashbackBalance(client: ProbeClient, userId: string): Promise<number> {
  const rows = await client.$queryRaw<Array<{ balance: bigint | number | null }>>`
    SELECT COALESCE(SUM(e."amount"), 0)::bigint AS "balance"
    FROM "CashbackEntry" e
    LEFT JOIN "Payment" p ON p."id" = e."paymentId"
    WHERE e."userId" = ${userId}
      AND (e."kind" <> 'SPENT' OR p."status" IN ('PENDING', 'RECONCILIATION_REQUIRED', 'SUCCESS'))`;
  return Number(rows[0]?.balance ?? 0);
}

/** A student's balance for checkout: null before the migration (checkout then doesn't offer cashback). */
export async function readCashbackBalance(client: ProbeClient, userId: string): Promise<number | null> {
  if (!(await cashbackTablesReady(client))) return null;
  try {
    return await cashbackBalance(client, userId);
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    noteCashbackSchemaMissing(error, "read balance");
    return null;
  }
}

export async function readCashbackSettings(client: Pick<Tx, "cashbackSettings">): Promise<CashbackSettingsValue> {
  const row = await client.cashbackSettings.findUnique({ where: { id: "default" }, select: { enabled: true, ratePercent: true, welcomeBonus: true } });
  return row ?? { ...DEFAULT_CASHBACK_SETTINGS };
}

export type CashbackHistoryEntry = { id: string; kind: CashbackKindCode; amount: number; note: string | null; createdAt: Date; orderId: string | null; returned: boolean };

/**
 * A student's balance and recent history, for their account, checkout and admin. `ready` is false before the
 * migration. A SPENT entry whose payment didn't go through is marked `returned`.
 */
export async function readStudentCashback(client: ProbeClient & Pick<Tx, "cashbackEntry">, userId: string, take = 15): Promise<{ ready: false } | { ready: true; balance: number; entries: CashbackHistoryEntry[] }> {
  if (!(await cashbackTablesReady(client))) return { ready: false };
  try {
    const [balance, rows] = await Promise.all([
      cashbackBalance(client, userId),
      client.cashbackEntry.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take, select: { id: true, kind: true, amount: true, note: true, createdAt: true, orderId: true, paymentId: true } }),
    ]);
    const spentPayments = rows.filter((row) => row.kind === "SPENT" && row.paymentId).map((row) => row.paymentId!);
    const holding = new Set(spentPayments.length
      ? (await client.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Payment" WHERE "id" = ANY(${spentPayments}) AND "status" IN ('PENDING', 'RECONCILIATION_REQUIRED', 'SUCCESS')`).map((row) => row.id)
      : []);
    return {
      ready: true,
      balance,
      entries: rows.map((row) => ({ id: row.id, kind: row.kind, amount: row.amount, note: row.note, createdAt: row.createdAt, orderId: row.orderId, returned: row.kind === "SPENT" && !holding.has(row.paymentId ?? "") })),
    };
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    noteCashbackSchemaMissing(error, "read balance");
    return { ready: false };
  }
}

/**
 * Called when an order or print job is delivered, inside its transaction: adds the % back on what was paid for the
 * items, and the welcome bonus the first time. Nothing when cashback is switched off. It can never fail the
 * delivery: it runs in a savepoint, and any error other than a serialization conflict (which the delivery's own retry
 * must see) is logged and swallowed. Returns the naira added (0 when nothing was).
 */
export async function creditCashbackOnDelivery(
  tx: ProbeClient & Pick<Tx, "$transaction">,
  input: { userId: string; source: "order" | "print"; id: string; itemsPaid: number },
): Promise<number> {
  try {
    if (!(await cashbackTablesReady(tx))) return 0;
    return await tx.$transaction(async (savepoint: Tx) => {
      const settings = await readCashbackSettings(savepoint);
      if (!settings.enabled) return 0;
      const link = input.source === "order" ? { orderId: input.id } : { printJobId: input.id };
      const earned = cashbackEarned(input.itemsPaid, settings.ratePercent);
      const credited = earned > 0
        ? (await savepoint.cashbackEntry.createMany({ data: [{ userId: input.userId, kind: "EARNED", amount: earned, key: `${input.source}:${input.id}`, ...link }], skipDuplicates: true })).count
        : 0;
      const welcomed = settings.welcomeBonus > 0
        ? (await savepoint.cashbackEntry.createMany({ data: [{ userId: input.userId, kind: "WELCOME", amount: settings.welcomeBonus, key: `welcome:${input.userId}`, ...link }], skipDuplicates: true })).count
        : 0;
      const added = (credited ? earned : 0) + (welcomed ? settings.welcomeBonus : 0);
      if (added > 0) {
        await savepoint.notification.createMany({
          data: [{
            userId: input.userId,
            type: "PAYMENT",
            title: welcomed ? "Welcome bonus + cashback 🎉" : "You earned cashback 🎉",
            message: `₦${added.toLocaleString("en-NG")} has been added to your PackAM cashback. Use it on your next order.`,
            relatedType: "CASHBACK",
            idempotencyKey: `cashback:${input.source}:${input.id}`,
          }],
          skipDuplicates: true,
        });
      }
      return added;
    });
  } catch (error) {
    if (isSerializationFailure(error)) throw error;
    if (isSchemaBehindCode(error)) noteCashbackSchemaMissing(error, "credit on delivery");
    else console.error("CASHBACK NOT CREDITED:", error instanceof Error ? error.name : "Unknown error");
    return 0;
  }
}

/** Records cashback used by a new payment attempt, in the payment's own transaction (it fails with it). */
export async function recordCashbackSpend(tx: Pick<Tx, "cashbackEntry">, input: { userId: string; paymentId: string; amount: number }) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Invalid cashback amount.");
  await tx.cashbackEntry.create({ data: { userId: input.userId, kind: "SPENT", amount: -input.amount, key: `spend:${input.paymentId}`, paymentId: input.paymentId } });
}
