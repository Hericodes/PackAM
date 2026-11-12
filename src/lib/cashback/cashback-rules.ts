/**
 * Cashback rules. Students have a naira balance:
 * - they EARN a % back (set by admins, 0–50%) on what they paid for the items of every delivered order and print
 *   job (after promo codes and cashback used; never on delivery), plus a one-off WELCOME bonus after their first
 *   delivery; admins can also ADJUST it by hand, with a reason;
 * - they SPEND it at shop and food checkout: as much as covers the items after any promo code. Delivery is always
 *   paid, so no payment is ever ₦0.
 * Pure, so every rule is unit-tested; src/lib/cashback/cashback-store.ts reads and writes the tables.
 */

export const CASHBACK_MAX_RATE = 50;
export const CASHBACK_MAX_WELCOME = 100_000;
/** The most one admin adjustment can add or take away. */
export const CASHBACK_MAX_ADJUSTMENT = 100_000;

export type CashbackSettingsValue = { enabled: boolean; ratePercent: number; welcomeBonus: number };
/** As the migration seeds it: switched off, 2%, no welcome bonus. */
export const DEFAULT_CASHBACK_SETTINGS: CashbackSettingsValue = { enabled: false, ratePercent: 2, welcomeBonus: 0 };

export type CashbackKindCode = "EARNED" | "WELCOME" | "ADJUSTMENT" | "SPENT";

/** Naira earned on what was paid for the items, rounded down. */
export function cashbackEarned(itemsPaid: number, ratePercent: number): number {
  if (!Number.isSafeInteger(itemsPaid) || itemsPaid <= 0 || !Number.isInteger(ratePercent) || ratePercent <= 0) return 0;
  return Math.floor((itemsPaid * Math.min(ratePercent, CASHBACK_MAX_RATE)) / 100);
}

/** How much of the balance a checkout uses: as much as covers the items after any promo code (never delivery). */
export function cashbackToUse(balance: number, itemsAfterPromo: number): number {
  if (!Number.isSafeInteger(balance) || balance <= 0 || !Number.isSafeInteger(itemsAfterPromo) || itemsAfterPromo <= 0) return 0;
  return Math.min(balance, itemsAfterPromo);
}

/** The cashback a checkout snapshot used (0 when none, or before cashback existed). Null when it is malformed. */
export function cashbackFromSnapshot(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return 0;
  const value = (snapshot as Record<string, unknown>).cashback;
  if (value === undefined) return 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const amount = (value as Record<string, unknown>).amount;
  return typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

const wholeNumber = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.trim().replace(/[,\s₦]/g, "")) : NaN);

/** Admin → Cashback settings: { enabled, ratePercent, welcomeBonus }. */
export function parseCashbackSettingsInput(raw: unknown): Parsed<CashbackSettingsValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Send the cashback settings." };
  const input = raw as Record<string, unknown>;
  if (typeof input.enabled !== "boolean") return { ok: false, error: "Choose whether cashback is on." };
  const ratePercent = wholeNumber(input.ratePercent);
  if (!Number.isInteger(ratePercent) || ratePercent < 0 || ratePercent > CASHBACK_MAX_RATE) return { ok: false, error: `The % back must be a whole number from 0 to ${CASHBACK_MAX_RATE}.` };
  const welcomeBonus = wholeNumber(input.welcomeBonus ?? 0);
  if (!Number.isInteger(welcomeBonus) || welcomeBonus < 0 || welcomeBonus > CASHBACK_MAX_WELCOME) return { ok: false, error: `The welcome bonus must be from ₦0 to ₦${CASHBACK_MAX_WELCOME.toLocaleString("en-NG")}.` };
  return { ok: true, data: { enabled: input.enabled, ratePercent, welcomeBonus } };
}

/** An admin's change to one student's balance: { amount (+ adds, − takes away), note }. */
export function parseCashbackAdjustment(raw: unknown): Parsed<{ amount: number; note: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Enter an amount and a reason." };
  const input = raw as Record<string, unknown>;
  const amount = wholeNumber(input.amount);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > CASHBACK_MAX_ADJUSTMENT) return { ok: false, error: `Enter a whole naira amount from ₦1 to ₦${CASHBACK_MAX_ADJUSTMENT.toLocaleString("en-NG")}; use minus to take some away.` };
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length < 3 || note.length > 200) return { ok: false, error: "Give a short reason (3 to 200 characters). The student sees it." };
  return { ok: true, data: { amount, note } };
}

/** How each kind of change reads in a student's history. */
export function cashbackEntryLabel(kind: CashbackKindCode, note: string | null) {
  if (kind === "EARNED") return "Cashback on a delivered order";
  if (kind === "WELCOME") return "Welcome bonus";
  if (kind === "SPENT") return "Used at checkout";
  return note ? `From PackAM: ${note}` : "From PackAM";
}
