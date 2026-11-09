/**
 * Promo code rules: cleaning up what a student types, the discount for an items subtotal, why a code can't be used,
 * and the labels students and admins see. Pure (no database, no server-only imports), so every rule is unit-tested
 * and checkout can recompute the discount in the browser exactly as the server will charge it.
 *
 * Codes come off the items only (shop and food checkout). The delivery fee is always paid, so a payment is never ₦0.
 */

export type PromoType = "PERCENT" | "FIXED";

/** What decides the discount. */
export type PromoRule = {
  type: PromoType;
  /** PERCENT: 1–100. FIXED: whole naira. */
  value: number;
  /** PERCENT only: the most it takes off, in naira. */
  maxDiscount: number | null;
  /** The items must come to at least this, in naira. */
  minSubtotal: number;
};

/** A stored code with everything that decides whether it can be used. */
export type PromoCodeState = PromoRule & {
  id: string;
  code: string;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  maxUsesPerStudent: number;
};

export const PROMO_CODE_PATTERN = /^[A-Z0-9]{3,20}$/;

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;
const campusDate = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

/** " welcome1k " → "WELCOME1K". Spaces are dropped; anything but letters and digits makes it invalid (null). */
export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\s+/g, "").toUpperCase();
  return PROMO_CODE_PATTERN.test(code) ? code : null;
}

/**
 * Naira off an items subtotal: a whole number from 0 up to the subtotal. Percentages round down (never over-discount),
 * then the cap applies. Below the minimum it is 0.
 */
export function promoDiscount(rule: PromoRule, subtotal: number) {
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || subtotal < rule.minSubtotal) return 0;
  let discount = rule.type === "FIXED" ? rule.value : Math.floor((subtotal * rule.value) / 100);
  if (rule.type === "PERCENT" && rule.maxDiscount !== null) discount = Math.min(discount, rule.maxDiscount);
  return Math.max(0, Math.min(discount, subtotal));
}

export type PromoRefusalReason = "INVALID" | "NOT_FOUND" | "PAUSED" | "NOT_STARTED" | "EXPIRED" | "USED_UP" | "ALREADY_USED" | "MIN_SUBTOTAL" | "NOTHING_OFF" | "UNAVAILABLE";

export const PROMO_MESSAGES = {
  INVALID: "Promo codes are 3–20 letters and numbers. Check it and try again.",
  NOT_FOUND: "We don’t know that promo code. Check the spelling and try again.",
  PAUSED: "That promo code isn’t active right now.",
  EXPIRED: "That promo code has expired.",
  USED_UP: "That promo code has been fully used.",
  NOTHING_OFF: "That promo code doesn’t take anything off this order.",
  UNAVAILABLE: "Promo codes aren’t available yet. You can still pay without one.",
} as const;

/** Why `code` can't be used now for this student and subtotal, or null when it can. Uses count paid checkouts only. */
export function promoRefusal(
  code: PromoCodeState | null,
  context: { now: Date; subtotal: number; usesTotal: number; usesByStudent: number },
): { reason: PromoRefusalReason; message: string } | null {
  if (!code) return { reason: "NOT_FOUND", message: PROMO_MESSAGES.NOT_FOUND };
  if (!code.active) return { reason: "PAUSED", message: PROMO_MESSAGES.PAUSED };
  if (code.startsAt && context.now < code.startsAt) return { reason: "NOT_STARTED", message: `That promo code starts on ${campusDate(code.startsAt)}.` };
  if (code.endsAt && context.now >= code.endsAt) return { reason: "EXPIRED", message: PROMO_MESSAGES.EXPIRED };
  if (code.maxUses !== null && context.usesTotal >= code.maxUses) return { reason: "USED_UP", message: PROMO_MESSAGES.USED_UP };
  if (context.usesByStudent >= code.maxUsesPerStudent) {
    return { reason: "ALREADY_USED", message: code.maxUsesPerStudent === 1 ? "You’ve already used this promo code." : `You’ve already used this promo code ${code.maxUsesPerStudent} times, the most allowed.` };
  }
  if (context.subtotal < code.minSubtotal) {
    return { reason: "MIN_SUBTOTAL", message: `This code needs items worth at least ${naira(code.minSubtotal)}. Add ${naira(code.minSubtotal - context.subtotal)} more to use it.` };
  }
  if (promoDiscount(code, context.subtotal) <= 0) return { reason: "NOTHING_OFF", message: PROMO_MESSAGES.NOTHING_OFF };
  return null;
}

/** "₦1,000 off your items", "10% off your items", "10% off your items (up to ₦2,000)". */
export function describePromo(rule: PromoRule) {
  const off = rule.type === "FIXED" ? `${naira(rule.value)} off your items` : `${rule.value}% off your items`;
  return rule.type === "PERCENT" && rule.maxDiscount !== null ? `${off} (up to ${naira(rule.maxDiscount)})` : off;
}

/** A refused code, with the reason a student can act on. Nothing was created or charged. */
export class PromoCodeRejectedError extends Error {
  constructor(readonly reason: PromoRefusalReason, message: string) {
    super(message);
    this.name = "PromoCodeRejectedError";
  }
}

/** The promo part of a checkout snapshot: frozen when the payment attempt is created. */
export type SnapshotPromo = { promoCodeId: string; code: string; discount: number };

/**
 * Reads the promo frozen into a payment's checkout snapshot. Strict: anything malformed is null (callers that move
 * money treat a present-but-invalid promo as an error; display code just shows no promo). The discount must be a
 * whole number from 1 up to the snapshot's subtotal.
 */
export function promoFromSnapshot(raw: unknown): SnapshotPromo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const snapshot = raw as Record<string, unknown>;
  const promo = snapshot.promo;
  if (!promo || typeof promo !== "object" || Array.isArray(promo)) return null;
  const { promoCodeId, code, discount } = promo as Record<string, unknown>;
  const subtotal = snapshot.subtotal;
  if (typeof promoCodeId !== "string" || !promoCodeId || typeof code !== "string" || !PROMO_CODE_PATTERN.test(code)) return null;
  if (typeof discount !== "number" || !Number.isSafeInteger(discount) || discount < 1) return null;
  if (typeof subtotal !== "number" || discount > subtotal) return null;
  return { promoCodeId, code, discount };
}

/** True when a snapshot carries a promo field at all (valid or not). */
export function snapshotHasPromo(raw: unknown) {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && "promo" in raw && (raw as Record<string, unknown>).promo !== undefined);
}

/** The code an attempt was created with (null for none), to resume it only for the same code. */
export function snapshotPromoCode(raw: unknown) {
  return promoFromSnapshot(raw)?.code ?? null;
}
