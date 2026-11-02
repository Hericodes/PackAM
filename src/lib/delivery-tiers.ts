/**
 * Delivery tiers for marketplace and food orders (never printing): the approved labels, descriptions and default
 * windows; the rules that turn database settings into checkout quotes; the payment snapshot fields; how a paid
 * order's speed is shown; and the dispatch priority, idle-runner and escalation rules. Pure (no server-only, no
 * Prisma runtime import), so checkout, the runner board and the admin page can import it and every rule is
 * unit-tested.
 *
 * Prices and on/off switches live in DeliveryTierSetting (admin "Delivery tiers" page). CHECKOUT_DELIVERY_FEE is
 * only the Cruise Mode fee used while that table doesn't exist yet (fallbackQuoteSet).
 */
import { CHECKOUT_DELIVERY_FEE } from "./checkout-pricing";

/** Every tier, in dispatch priority order (the Prisma enum's declaration order). */
export const DELIVERY_TIER_CODES = ["OYA", "SHARP", "CRUISE"] as const;
export type DeliveryTierCode = (typeof DELIVERY_TIER_CODES)[number];
export type UrgentDeliveryTier = "OYA" | "SHARP";

/** How checkout and the admin page list them: the approved table's order. */
export const DISPLAY_ORDER: readonly DeliveryTierCode[] = ["CRUISE", "SHARP", "OYA"];
/** Dispatch priority, highest first. Orders without a tier (and print jobs) rank with Cruise Mode. */
export const PRIORITY_ORDER: readonly DeliveryTierCode[] = ["OYA", "SHARP", "CRUISE"];
export const URGENT_TIERS: readonly UrgentDeliveryTier[] = ["OYA", "SHARP"];

export const DELIVERY_TIER_LABELS: Record<DeliveryTierCode, string> = {
  CRUISE: "Cruise Mode",
  SHARP: "Sharp Sharp",
  OYA: "Oya Now!",
};

/** The owner-approved wording, with PackAM's typographic apostrophes. */
export const DELIVERY_TIER_DESCRIPTIONS: Record<DeliveryTierCode, string> = {
  CRUISE: "No rush, we’re coming. Your order joins the next delivery batch.",
  SHARP: "Need it a little quicker? We’ve got you.",
  OYA: "When you need it ASAP. Your order gets top delivery priority.",
};

/** The approved windows. The live ones are DeliveryTierSetting rows; these cover the fallback and a missing row. */
export const DEFAULT_ETA_MINUTES: Record<DeliveryTierCode, { min: number; max: number }> = {
  CRUISE: { min: 20, max: 30 },
  SHARP: { min: 15, max: 25 },
  OYA: { min: 10, max: 15 },
};

/**
 * Minutes after an urgent order starts looking for a runner (Order.findingRunnerAt) before admins are alerted
 * once and the order opens to every available runner, not only runners with no active missions.
 */
export const ESCALATION_MINUTES: Record<UrgentDeliveryTier, number> = { OYA: 5, SHARP: 10 };

/** Orders with no tier row: paid before delivery tiers, or while the tier tables were missing. */
export const STANDARD_DELIVERY_LABEL = "Standard delivery";

/** Engineering guard (typos, int4 totals): not a pricing decision. */
export const MAX_DELIVERY_TIER_FEE = 100_000;
/** Same bound as the database CHECK constraints. */
export const MAX_ETA_MINUTES = 1440;

const CODES = new Set<string>(DELIVERY_TIER_CODES);

/** Exactly "OYA", "SHARP" or "CRUISE"; anything else (lowercase, null, numbers, "__proto__") is null. */
export function parseDeliveryTier(value: unknown): DeliveryTierCode | null {
  return typeof value === "string" && CODES.has(value) ? (value as DeliveryTierCode) : null;
}

export function isUrgentTier(tier: string | null | undefined): tier is UrgentDeliveryTier {
  return tier === "OYA" || tier === "SHARP";
}

/** A fee a tier can be sold at: whole naira, at least ₦1. */
export function isValidTierFee(fee: unknown): fee is number {
  return typeof fee === "number" && Number.isSafeInteger(fee) && fee >= 1 && fee <= MAX_DELIVERY_TIER_FEE;
}

export function isValidEtaWindow(min: unknown, max: unknown): boolean {
  return typeof min === "number" && typeof max === "number" && Number.isSafeInteger(min) && Number.isSafeInteger(max)
    && min >= 1 && max >= min && max <= MAX_ETA_MINUTES;
}

// ---------------------------------------------------------------------------------------------------------------
// Quotes

/** A DeliveryTierSetting row as read by the store (explicit select). */
export type DeliveryTierSettingRow = { tier: string; fee: number | null; enabled: boolean; etaMinMinutes: number; etaMaxMinutes: number; version: number };

export type DeliveryTierQuote = {
  tier: DeliveryTierCode;
  label: string;
  description: string;
  /** Whole naira; null when no price is set. */
  fee: number | null;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  /** On, with a valid fee and window: a student can pay for it right now. */
  available: boolean;
  /** DeliveryTierSetting.version; null in the fallback (no settings table). */
  settingsVersion: number | null;
};

export type DeliveryTierQuoteSet = {
  /** "fallback": the settings table is missing (or empty), so only Cruise Mode at CHECKOUT_DELIVERY_FEE exists. */
  source: "settings" | "fallback";
  /** Always the three tiers, in DISPLAY_ORDER. */
  quotes: DeliveryTierQuote[];
};

function quote(tier: DeliveryTierCode, fields: Pick<DeliveryTierQuote, "fee" | "etaMinMinutes" | "etaMaxMinutes" | "available" | "settingsVersion">): DeliveryTierQuote {
  return { tier, label: DELIVERY_TIER_LABELS[tier], description: DELIVERY_TIER_DESCRIPTIONS[tier], ...fields };
}

/** Today's behaviour, used until the settings table exists: Cruise Mode only, ₦200, 20–30 minutes. */
export function fallbackQuoteSet(): DeliveryTierQuoteSet {
  return {
    source: "fallback",
    quotes: DISPLAY_ORDER.map((tier) => tier === "CRUISE"
      ? quote(tier, { fee: CHECKOUT_DELIVERY_FEE, etaMinMinutes: DEFAULT_ETA_MINUTES.CRUISE.min, etaMaxMinutes: DEFAULT_ETA_MINUTES.CRUISE.max, available: true, settingsVersion: null })
      : quote(tier, { fee: null, etaMinMinutes: DEFAULT_ETA_MINUTES[tier].min, etaMaxMinutes: DEFAULT_ETA_MINUTES[tier].max, available: false, settingsVersion: null })),
  };
}

/**
 * Quotes from the settings rows. No rows at all (table missing, or read in a snapshot taken before the seed
 * committed) means the fallback. A missing row, or a row that is off, unpriced or has a bad window, makes only that
 * tier unavailable: never a different tier, never a guessed price.
 */
export function quotesFromRows(rows: readonly DeliveryTierSettingRow[] | null | undefined): DeliveryTierQuoteSet {
  if (!rows || rows.length === 0) return fallbackQuoteSet();
  return {
    source: "settings",
    quotes: DISPLAY_ORDER.map((tier) => {
      const row = rows.find((candidate) => candidate.tier === tier);
      if (!row) return quote(tier, { fee: null, etaMinMinutes: DEFAULT_ETA_MINUTES[tier].min, etaMaxMinutes: DEFAULT_ETA_MINUTES[tier].max, available: false, settingsVersion: null });
      const windowOk = isValidEtaWindow(row.etaMinMinutes, row.etaMaxMinutes);
      return quote(tier, {
        fee: row.fee,
        etaMinMinutes: windowOk ? row.etaMinMinutes : DEFAULT_ETA_MINUTES[tier].min,
        etaMaxMinutes: windowOk ? row.etaMaxMinutes : DEFAULT_ETA_MINUTES[tier].max,
        available: row.enabled && isValidTierFee(row.fee) && windowOk,
        settingsVersion: row.version,
      });
    }),
  };
}

export function quoteFor(set: DeliveryTierQuoteSet, tier: DeliveryTierCode): DeliveryTierQuote {
  return set.quotes.find((candidate) => candidate.tier === tier) ?? fallbackQuoteSet().quotes.find((candidate) => candidate.tier === tier)!;
}

/** "20–30 minutes" (checkout, as approved) or "20–30 min" (badges, lists). */
export function formatEta(min: number, max: number, style: "long" | "short" = "long") {
  const range = min === max ? `${min}` : `${min}–${max}`;
  return `${range} ${style === "long" ? "minutes" : "min"}`;
}

/** For "Delivery from ₦200" copy outside checkout: the cheapest available fee and how many speeds are on sale. */
export function deliveryPriceSummary(quotes: readonly DeliveryTierQuote[]): { fromFee: number; options: number } | null {
  const fees = quotes.filter((candidate) => candidate.available && candidate.fee !== null).map((candidate) => candidate.fee as number);
  return fees.length ? { fromFee: Math.min(...fees), options: fees.length } : null;
}

/** The delivery fee a checkout shows and sends for review: 0 with no items or no available tier chosen. */
export function checkoutDeliveryFee(selected: Pick<DeliveryTierQuote, "available" | "fee"> | null | undefined, itemCount: number) {
  return itemCount > 0 && selected?.available && selected.fee !== null ? selected.fee : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// The payment request

export type CheckoutDeliveryRequest =
  | { ok: true; tier: DeliveryTierCode | undefined; reviewedDeliveryFee: number | undefined }
  | { ok: false; code: "INVALID_DELIVERY_TIER" | "INVALID_REVIEWED_DELIVERY_FEE"; error: string };

/**
 * The delivery part of POST /api/payments/create. No `deliveryTier` (a checkout tab opened before tiers) means
 * Cruise Mode, which is all that tab ever showed. A present but unknown tier is refused, never mapped to Cruise.
 * reviewedDeliveryFee is only compared with the server's fee; it is never charged.
 */
export function parseCheckoutDeliveryRequest(body: unknown): CheckoutDeliveryRequest {
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const hasTier = Object.hasOwn(record, "deliveryTier");
  const hasFee = Object.hasOwn(record, "reviewedDeliveryFee");
  const tier = hasTier ? parseDeliveryTier(record.deliveryTier) : undefined;
  if (hasTier && tier === null) return { ok: false, code: "INVALID_DELIVERY_TIER", error: "Choose a delivery speed, then pay." };
  // A client that knows about fees always sends its tier too: never let it fall back to Cruise silently.
  if (hasFee && !hasTier) return { ok: false, code: "INVALID_DELIVERY_TIER", error: "Choose a delivery speed, then pay." };
  const fee = record.reviewedDeliveryFee;
  if (hasFee && (typeof fee !== "number" || !Number.isSafeInteger(fee) || fee < 0)) {
    return { ok: false, code: "INVALID_REVIEWED_DELIVERY_FEE", error: "Refresh checkout to see your total, then pay." };
  }
  return { ok: true, tier: tier ?? undefined, reviewedDeliveryFee: hasFee ? fee as number : undefined };
}

// ---------------------------------------------------------------------------------------------------------------
// Payment.checkoutSnapshot fields (no new column: the snapshot is JSON)

export type SnapshotDeliveryTierFields = {
  deliveryTier: DeliveryTierCode;
  deliveryEtaMinMinutes: number;
  deliveryEtaMaxMinutes: number;
  /** null when quoted from the fallback (no settings table). */
  deliveryTierSettingsVersion: number | null;
};

export function snapshotDeliveryTierFields(selected: DeliveryTierQuote): SnapshotDeliveryTierFields {
  return {
    deliveryTier: selected.tier,
    deliveryEtaMinMinutes: selected.etaMinMinutes,
    deliveryEtaMaxMinutes: selected.etaMaxMinutes,
    deliveryTierSettingsVersion: selected.settingsVersion,
  };
}

export type SnapshotDeliveryTier =
  /** Created before delivery tiers: no tier row, "Standard delivery", Cruise priority. */
  | { kind: "legacy" }
  | { kind: "tier"; tier: DeliveryTierCode; etaMinMinutes: number; etaMaxMinutes: number; settingsVersion: number | null }
  /** Tier fields present but unusable: the order is still created, with no row, and admins are alerted. */
  | { kind: "invalid" };

/** Lenient on purpose: it runs when a verified payment becomes an order, which must never fail because of it. */
export function parseSnapshotDeliveryTier(raw: unknown): SnapshotDeliveryTier {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "legacy" };
  const snapshot = raw as Record<string, unknown>;
  if (snapshot.deliveryTier === undefined) return { kind: "legacy" };
  const tier = parseDeliveryTier(snapshot.deliveryTier);
  const min = snapshot.deliveryEtaMinMinutes;
  const max = snapshot.deliveryEtaMaxMinutes;
  const version = snapshot.deliveryTierSettingsVersion ?? null;
  if (!tier || !isValidEtaWindow(min, max)) return { kind: "invalid" };
  if (version !== null && !(typeof version === "number" && Number.isSafeInteger(version) && version >= 1)) return { kind: "invalid" };
  return { kind: "tier", tier, etaMinMinutes: min as number, etaMaxMinutes: max as number, settingsVersion: version as number | null };
}

/** The tier an existing attempt was created for, to refuse reusing its idempotency key for another tier. */
export function snapshotTierForReuse(raw: unknown): DeliveryTierCode | null {
  const parsed = parseSnapshotDeliveryTier(raw);
  return parsed.kind === "legacy" ? "CRUISE" : parsed.kind === "tier" ? parsed.tier : null;
}

/** When a paid order is due: payment confirmation + the upper end of its window. */
export function deliveryDueAt(confirmedAt: Date, etaMaxMinutes: number) {
  return new Date(confirmedAt.getTime() + etaMaxMinutes * 60_000);
}

// ---------------------------------------------------------------------------------------------------------------
// Showing a paid order's speed (the fee always comes from Order.deliveryFee)

export type OrderDeliveryDisplay =
  | { kind: "tier"; tier: DeliveryTierCode; label: string; urgent: boolean; eta: string; etaShort: string; dueAt: Date }
  | { kind: "standard"; tier: null; label: string; urgent: false; eta: null; etaShort: null; dueAt: null };

export function describeOrderDelivery(row: { tier: string; etaMinMinutes: number; etaMaxMinutes: number; dueAt: Date | string } | null | undefined): OrderDeliveryDisplay {
  const tier = row ? parseDeliveryTier(row.tier) : null;
  const dueAt = row ? new Date(row.dueAt) : null;
  if (!row || !tier || !dueAt || Number.isNaN(dueAt.getTime())) {
    return { kind: "standard", tier: null, label: STANDARD_DELIVERY_LABEL, urgent: false, eta: null, etaShort: null, dueAt: null };
  }
  return {
    kind: "tier", tier, label: DELIVERY_TIER_LABELS[tier], urgent: isUrgentTier(tier),
    eta: formatEta(row.etaMinMinutes, row.etaMaxMinutes, "long"), etaShort: formatEta(row.etaMinMinutes, row.etaMaxMinutes, "short"), dueAt,
  };
}

/** StatusBadge tone for a speed (string union matching StatusTone in ops-status.ts); no tier = neutral. */
export function deliveryTierTone(tier: string | null | undefined): "danger" | "progress" | "info" | "neutral" {
  return tier === "OYA" ? "danger" : tier === "SHARP" ? "progress" : tier === "CRUISE" ? "info" : "neutral";
}

/** A time of day in campus time, e.g. "15:45" (en-NG formats 24-hour). Pass the zone: servers run in UTC. */
export function formatCampusClock(date: Date) {
  return date.toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------------------------------------------
// Dispatch

/** 0 = first. Orders without a tier and print missions rank with Cruise Mode. */
export function tierRank(tier: string | null | undefined): number {
  const index = PRIORITY_ORDER.indexOf(tier as DeliveryTierCode);
  return index === -1 ? PRIORITY_ORDER.indexOf("CRUISE") : index;
}

function escalationAt(tier: UrgentDeliveryTier, startedAt: Date) {
  return startedAt.getTime() + ESCALATION_MINUTES[tier] * 60_000;
}

/**
 * Only runners with no active (ACCEPTED) missions may be offered or accept this order: true for an urgent tier
 * until it is escalated or its threshold has passed (whichever comes first), so a slow scheduler never keeps
 * the restriction on longer than promised.
 */
export function idleRunnerRuleApplies(input: { tier: string | null | undefined; startedAt: Date; escalatedAt: Date | null; now: Date }) {
  if (!isUrgentTier(input.tier) || input.escalatedAt) return false;
  return input.now.getTime() < escalationAt(input.tier, input.startedAt);
}

/** An urgent order still waiting for a runner past its threshold, not yet escalated. */
export function urgentEscalationDue(input: { tier: string | null | undefined; startedAt: Date; escalatedAt: Date | null; status: string; assignedRunnerId: string | null; now: Date }) {
  if (!isUrgentTier(input.tier) || input.escalatedAt) return false;
  if (input.status !== "FINDING_RUNNER" || input.assignedRunnerId) return false;
  return input.now.getTime() >= escalationAt(input.tier, input.startedAt);
}

/** An urgent order never reaches refund review before its idle-runner restriction has lifted. */
export function urgentSafeDeadlineMinutes(tier: string | null | undefined, deadlineMinutes: number) {
  return isUrgentTier(tier) ? Math.max(deadlineMinutes, ESCALATION_MINUTES[tier]) : deadlineMinutes;
}

/** Both messages contain "mission", so the runner orders route forwards them (its message filter). */
export const HOLDS_URGENT_MISSION_MESSAGE = "Finish your current urgent mission before accepting another mission.";
export const URGENT_NEEDS_IDLE_RUNNER_MESSAGE = "This urgent mission is for runners with no active missions. Finish your current missions first.";

export type TierAcceptance = { ok: true } | { ok: false; message: string };

export function decideTierAcceptance(input: { orderTier: string | null | undefined; idleRuleActive: boolean; activeMissions: number; holdsUrgent: boolean }): TierAcceptance {
  if (input.holdsUrgent) return { ok: false, message: HOLDS_URGENT_MISSION_MESSAGE };
  if (isUrgentTier(input.orderTier) && input.idleRuleActive && input.activeMissions > 0) return { ok: false, message: URGENT_NEEDS_IDLE_RUNNER_MESSAGE };
  return { ok: true };
}

/** The one admin alert per unaccepted urgent order (notifyAdmins, idempotency key `urgent-unaccepted:<orderId>`). */
export const URGENT_ESCALATION_TITLE = "Urgent delivery not accepted";

export function urgentEscalationMessage(tier: UrgentDeliveryTier, orderReference: string) {
  return `${DELIVERY_TIER_LABELS[tier]} order ${orderReference} wasn’t accepted within ${ESCALATION_MINUTES[tier]} minutes. It’s now offered to every available runner. Check that someone picks it up.`;
}

/** Runner lists: higher priority first, then whoever has waited longest. */
export function compareMissionPriority(a: { rank: number; waitingSince: number }, b: { rank: number; waitingSince: number }) {
  return a.rank - b.rank || a.waitingSince - b.waitingSince;
}
