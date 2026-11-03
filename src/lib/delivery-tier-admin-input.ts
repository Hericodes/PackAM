/**
 * Admin → Delivery tiers, the pure part: validating a change, deciding it against the current rows, the history
 * wording, and the plain values the page shows. Pure (no server-only, no Prisma runtime import), so the client
 * component can import it and every rule is unit-tested; the admin API (delivery-tier-admin.ts) applies the same
 * rules on the server inside its transaction. Only a tier's fee and on/off switch can change: delivery windows live
 * in the database rows (changed by migration only) and labels and descriptions are code constants.
 */
import { DELIVERY_TIER_LABELS, MAX_DELIVERY_TIER_FEE, formatEta, isValidTierFee, parseDeliveryTier, quotesFromRows, type DeliveryTierCode } from "./delivery-tiers";
import { parseNairaInput } from "./products/product-form";
import { formatCampusTime } from "./student-copy";

export type TierSettingChange = { tier: DeliveryTierCode; version: number; fee?: number | null; enabled?: boolean };
export type TierSettingState = { fee: number | null; enabled: boolean };

type Parsed = { ok: true; data: TierSettingChange } | { ok: false; error: string; field?: "tier" | "version" | "fee" | "enabled" };

/** The one wording for a fee out of range, in the browser and on the server. */
export const TIER_FEE_RULE = `Set the fee in whole naira, from ₦1 to ₦${MAX_DELIVERY_TIER_FEE.toLocaleString("en-NG")}.`;

/** The PATCH body: { tier, version, fee?, enabled? }. Every other key is ignored. */
export function parseTierSettingChange(body: unknown): Parsed {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  const b = body as Record<string, unknown>;
  const tier = parseDeliveryTier(b.tier);
  if (!tier) return { ok: false, error: "Choose a delivery tier.", field: "tier" };
  if (typeof b.version !== "number" || !Number.isSafeInteger(b.version) || b.version < 1) return { ok: false, error: "Refresh the page, then try again.", field: "version" };
  const data: TierSettingChange = { tier, version: b.version };
  if (b.fee !== undefined) {
    if (b.fee !== null && !isValidTierFee(b.fee)) return { ok: false, error: TIER_FEE_RULE, field: "fee" };
    data.fee = b.fee as number | null;
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return { ok: false, error: "Choose on or off.", field: "enabled" };
    data.enabled = b.enabled;
  }
  if (data.fee === undefined && data.enabled === undefined) return { ok: false, error: "There’s nothing to change." };
  return { ok: true, data };
}

export type TierSettingDecision =
  | { ok: true; next: TierSettingState; changed: boolean }
  | { ok: false; status: 400 | 409; code: "FEE_REQUIRED" | "LAST_ENABLED_TIER"; error: string };

/**
 * The row after the change, checked as a whole (a fee-only or switch-only change is merged with the current row
 * first). `others`: the other tiers as they are now, read in the same serializable transaction.
 */
export function applyTierSettingChange(current: TierSettingState, change: TierSettingChange, others: readonly TierSettingState[]): TierSettingDecision {
  const next: TierSettingState = {
    fee: change.fee === undefined ? current.fee : change.fee,
    enabled: change.enabled ?? current.enabled,
  };
  const label = DELIVERY_TIER_LABELS[change.tier];
  if (next.enabled && !isValidTierFee(next.fee)) {
    return { ok: false, status: 400, code: "FEE_REQUIRED", error: `Set a fee of at least ₦1 before turning ${label} on.` };
  }
  // Only another tier checkout can actually sell counts (on, with a valid fee).
  if (current.enabled && !next.enabled && !others.some((other) => other.enabled && isValidTierFee(other.fee))) {
    return { ok: false, status: 409, code: "LAST_ENABLED_TIER", error: `${label} is the only delivery speed on. Turn another one on first, so students can always check out.` };
  }
  return { ok: true, next, changed: next.fee !== current.fee || next.enabled !== current.enabled };
}

function stateOf(value: unknown): TierSettingState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const fee = record.fee === null || (typeof record.fee === "number" && Number.isSafeInteger(record.fee)) ? record.fee as number | null : undefined;
  return fee !== undefined && typeof record.enabled === "boolean" ? { fee, enabled: record.enabled } : null;
}

const feeText = (fee: number | null) => fee === null ? "no fee" : `₦${fee.toLocaleString("en-NG")}`;
const switchText = (enabled: boolean) => enabled ? "on" : "off";

/** One line for the tier history and the audit details, e.g. "Sharp Sharp: ₦300 → ₦350; on → off". Never throws. */
export function describeTierChange(tier: string, previous: unknown, next: unknown): string {
  const code = parseDeliveryTier(tier);
  const label = code ? DELIVERY_TIER_LABELS[code] : tier;
  const before = stateOf(previous);
  const after = stateOf(next);
  if (!before || !after) return `${label}: changed`;
  const parts = [
    before.fee !== after.fee ? `${feeText(before.fee)} → ${feeText(after.fee)}` : null,
    before.enabled !== after.enabled ? `${switchText(before.enabled)} → ${switchText(after.enabled)}` : null,
  ].filter(Boolean);
  return `${label}: ${parts.length ? parts.join("; ") : "no change"}`;
}

/** A tier's price and status as the history shows them, e.g. "₦300 · Enabled" or "No fee · Disabled". */
export function tierStateLabel(state: TierSettingState) {
  return `${state.fee === null ? "No fee" : `₦${state.fee.toLocaleString("en-NG")}`} · ${state.enabled ? "Enabled" : "Disabled"}`;
}

// ---------------------------------------------------------------------------------------------------------------
// What the admin page shows. Plain values only (no Prisma types), so the client component takes them as props.

/** A DeliveryTierSetting row as the admin page reads it. */
export type AdminTierRow = { tier: string; fee: number | null; enabled: boolean; etaMinMinutes: number; etaMaxMinutes: number; version: number; updatedAt: Date };

export type AdminTierCard = {
  tier: DeliveryTierCode;
  label: string;
  description: string;
  /** "20–30 minutes". Read-only on this page. */
  eta: string;
  /** Whole naira; null when no price is set. */
  fee: number | null;
  /** The on/off switch (before the migration: whether checkout offers it). */
  enabled: boolean;
  /** The row's edit version, sent back with a change. null: there is no row to edit (before the migration), so the card is read-only. */
  version: number | null;
  /** When the row last changed, in campus time; null without a row. */
  updatedAtLabel: string | null;
};

/**
 * The three cards in display order (Cruise Mode, Sharp Sharp, Oya Now!), showing what checkout does with these rows:
 * `rows` null (tables missing) or empty gives the fallback, Cruise Mode only at its legacy fee, with no version.
 */
export function adminTierCards(rows: readonly AdminTierRow[] | null): AdminTierCard[] {
  return quotesFromRows(rows).quotes.map((quote) => {
    const row = rows?.find((candidate) => candidate.tier === quote.tier);
    return {
      tier: quote.tier,
      label: quote.label,
      description: quote.description,
      eta: formatEta(quote.etaMinMinutes, quote.etaMaxMinutes),
      fee: row ? row.fee : quote.fee,
      enabled: row ? row.enabled : quote.available,
      version: row ? row.version : null,
      updatedAtLabel: row ? formatCampusTime(row.updatedAt) : null,
    };
  });
}

/** A DELIVERY_TIER_UPDATED audit row with its administrator. */
export type AdminTierAuditRow = {
  id: string;
  resourceId: string;
  previousState: unknown;
  newState: unknown;
  createdAt: Date;
  actor: { firstName: string | null; lastName: string | null; email: string };
};

export type AdminTierHistoryEntry = {
  id: string;
  /** "Sharp Sharp: ₦300 → ₦350". */
  summary: string;
  /** "₦300 · Enabled"; null if the stored state can't be read. */
  before: string | null;
  after: string | null;
  adminName: string;
  adminEmail: string;
  /** When it was saved, in campus time. */
  atLabel: string;
};

export function adminTierHistoryEntry(row: AdminTierAuditRow): AdminTierHistoryEntry {
  const before = stateOf(row.previousState);
  const after = stateOf(row.newState);
  const name = [row.actor.firstName, row.actor.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  return {
    id: row.id,
    summary: describeTierChange(row.resourceId, row.previousState, row.newState),
    before: before && tierStateLabel(before),
    after: after && tierStateLabel(after),
    adminName: name || row.actor.email,
    adminEmail: row.actor.email,
    atLabel: formatCampusTime(row.createdAt),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The card's form, checked in the browser before anything is sent (the API checks it again).

/** The fee field as typed ("350", "1,500", "₦1,500" or empty). Empty is "no fee", allowed only while the tier is off. */
export function parseTierFeeDraft(text: string, enabled: boolean, tier: DeliveryTierCode): { ok: true; fee: number | null } | { ok: false; error: string } {
  const fee = parseNairaInput(text);
  if (fee === null) return enabled ? { ok: false, error: `Set a fee before turning ${DELIVERY_TIER_LABELS[tier]} on.` } : { ok: true, fee: null };
  if (!isValidTierFee(fee)) return { ok: false, error: TIER_FEE_RULE };
  return { ok: true, fee };
}

/** Asked before a tier is turned off. */
export function turnOffConfirmation(tier: DeliveryTierCode) {
  const label = DELIVERY_TIER_LABELS[tier];
  const olderTabs = tier === "CRUISE" ? " Students with an older checkout page open will need to refresh." : "";
  return `Turn off ${label}? Students won’t be able to choose it at checkout. Orders already paid keep their speed and fee.${olderTabs}`;
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * True when the database refused a write because of a CHECK constraint (Postgres 23514). Prisma 7 with the pg
 * driver adapter reports it as P2039, with the Postgres code in meta.driverAdapterError.cause.originalCode and the
 * constraint named in the message. The API answers 400 then; nothing was written.
 */
export function isCheckViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const { message, meta } = error as { message?: unknown; meta?: unknown };
  const cause = meta && typeof meta === "object" ? (meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } }).driverAdapterError?.cause : undefined;
  if (cause?.originalCode === "23514") return true;
  let metaText = "";
  try { metaText = JSON.stringify(meta) ?? ""; } catch { metaText = ""; }
  return /violates check constraint/i.test(`${typeof message === "string" ? message : ""} ${metaText}`);
}

/**
 * True for a serializable conflict or deadlock wherever it surfaced: P2034 from a query, or, when COMMIT itself fails,
 * the pg adapter's raw DriverAdapterError (kind TransactionWriteConflict, Postgres 40001/40P01), which Prisma 7.10
 * rethrows without converting it to P2034. Either way the transaction was rolled back, so it is safe to run it again.
 */
export function isWriteConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown; cause?: unknown };
  if (candidate.code === "P2034") return true;
  if (candidate.name !== "DriverAdapterError" || !candidate.cause || typeof candidate.cause !== "object") return false;
  const cause = candidate.cause as { kind?: unknown; originalCode?: unknown };
  return cause.kind === "TransactionWriteConflict" || cause.originalCode === "40001" || cause.originalCode === "40P01";
}
