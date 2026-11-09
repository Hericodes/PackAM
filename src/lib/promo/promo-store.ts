/**
 * The only checkout code that reads or writes the promo tables (PromoCode, PromoRedemption). Works on a database
 * without migration 20261109090000_promo_codes: a code is then refused with "Promo codes aren't available yet" and
 * checkout without a code is untouched.
 *
 * - A probe (to_regclass) runs first. It never fails, so it can't abort the payment transaction. Only "ready" is
 *   remembered; while the tables are missing every call probes again, so codes switch on as soon as the migration is
 *   applied, with no redeploy.
 * - Lookups run in a savepoint (client.$transaction): inside createPaymentAttempt's transaction a failure rolls back
 *   only the savepoint. Await them on their own, never inside Promise.all with other work on the same transaction.
 *
 * Takes the client as an argument (db or a transaction), like priceCart, and imports neither db nor server-only, so
 * the fallbacks are unit-tested with fake clients.
 */
import type { Prisma } from "@prisma/client";
import { PROMO_CODE_MIGRATION, isSchemaBehindCode, missingSchemaElement } from "../db-errors";
import { PROMO_MESSAGES, PromoCodeRejectedError, describePromo, normalizePromoCode, promoDiscount, promoRefusal, type PromoCodeState, type PromoRule } from "./promo-rules";

type Tx = Prisma.TransactionClient;
type ProbeClient = Pick<Tx, "$queryRaw">;
type LookupClient = ProbeClient & Pick<Tx, "$transaction">;

let tablesReady = false;
let reportedMissing = false;

function reportMissingOnce(what: string) {
  if (reportedMissing) return;
  reportedMissing = true;
  console.error(`SCHEMA BEHIND CODE in promo codes: the database is missing ${what}. Checkout refuses promo codes until migration ${PROMO_CODE_MIGRATION} is applied (npx prisma migrate deploy).`);
}

/** True once both promo tables exist. Safe inside a transaction: to_regclass returns NULL instead of failing. */
export async function promoTablesReady(client: ProbeClient): Promise<boolean> {
  if (tablesReady) return true;
  const rows = await client.$queryRaw<Array<{ ready: boolean | null }>>`SELECT (to_regclass('public."PromoCode"') IS NOT NULL AND to_regclass('public."PromoRedemption"') IS NOT NULL) AS "ready"`;
  tablesReady = rows[0]?.ready === true;
  if (!tablesReady) reportMissingOnce("the promo tables");
  return tablesReady;
}

/** A promo query hit schema lag although the probe said ready (e.g. the migration was rolled back): probe again. */
export function notePromoSchemaMissing(error: unknown, where: string) {
  tablesReady = false;
  reportMissingOnce(`${missingSchemaElement(error)} (${where})`);
}

/** Tests only: forget the probe result and the log-once flag. */
export function resetPromoProbe() {
  tablesReady = false;
  reportedMissing = false;
}

/** Payment statuses at which a checkout counts as a use of its code. A failed or abandoned attempt never counts. */
export const PROMO_PAID_STATUSES = ["SUCCESS", "RECONCILIATION_REQUIRED"] as const;

const CODE_SELECT = { id: true, code: true, type: true, value: true, maxDiscount: true, minSubtotal: true, maxUses: true, maxUsesPerStudent: true, startsAt: true, endsAt: true, active: true } as const;

async function lookUp(client: Tx, code: string, userId: string) {
  const promo = await client.promoCode.findUnique({ where: { code }, select: CODE_SELECT });
  if (!promo) return null;
  const paid = { payment: { status: { in: [...PROMO_PAID_STATUSES] } } };
  const usesTotal = await client.promoRedemption.count({ where: { promoCodeId: promo.id, ...paid } });
  const usesByStudent = await client.promoRedemption.count({ where: { promoCodeId: promo.id, userId, ...paid } });
  return { promo: promo as PromoCodeState, usesTotal, usesByStudent };
}

/** A code that can be used for this checkout: what the student sees and what the payment freezes. */
export type CheckoutPromo = {
  promoCodeId: string;
  code: string;
  /** Naira off this subtotal. */
  discount: number;
  /** "₦1,000 off your items". */
  label: string;
  /** So checkout can recompute the discount when quantities change. */
  rule: PromoRule;
};

/**
 * Decides whether `rawCode` can be used by `userId` for an items subtotal, right now. Throws PromoCodeRejectedError
 * with the reason a student can act on (including "not available yet" before the migration); never anything about
 * the database. Inside createPaymentAttempt pass its transaction: the lookup runs in a savepoint.
 */
export async function resolveCheckoutPromo(client: LookupClient, rawCode: unknown, userId: string, subtotal: number, now: Date = new Date()): Promise<CheckoutPromo> {
  const code = normalizePromoCode(rawCode);
  if (!code) throw new PromoCodeRejectedError("INVALID", PROMO_MESSAGES.INVALID);
  if (!(await promoTablesReady(client))) throw new PromoCodeRejectedError("UNAVAILABLE", PROMO_MESSAGES.UNAVAILABLE);
  let found: Awaited<ReturnType<typeof lookUp>>;
  try {
    found = await client.$transaction((savepoint: Tx) => lookUp(savepoint, code, userId));
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    notePromoSchemaMissing(error, "checkout lookup");
    throw new PromoCodeRejectedError("UNAVAILABLE", PROMO_MESSAGES.UNAVAILABLE);
  }
  const refusal = promoRefusal(found?.promo ?? null, { now, subtotal, usesTotal: found?.usesTotal ?? 0, usesByStudent: found?.usesByStudent ?? 0 });
  if (refusal || !found) throw new PromoCodeRejectedError(refusal?.reason ?? "NOT_FOUND", refusal?.message ?? PROMO_MESSAGES.NOT_FOUND);
  const { promo } = found;
  const rule: PromoRule = { type: promo.type, value: promo.value, maxDiscount: promo.maxDiscount, minSubtotal: promo.minSubtotal };
  return { promoCodeId: promo.id, code: promo.code, discount: promoDiscount(rule, subtotal), label: describePromo(rule), rule };
}

/**
 * Records that a payment attempt used a code, in the attempt's own transaction (call right after the payment row is
 * created). Not in a savepoint on purpose: if it fails the whole attempt rolls back, so a discount is never charged
 * without the use being counted.
 */
export function recordPromoRedemption(tx: Pick<Tx, "promoRedemption">, input: { promoCodeId: string; userId: string; paymentId: string; discount: number }) {
  return tx.promoRedemption.create({ data: input, select: { id: true } });
}
