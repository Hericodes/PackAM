/**
 * Admin → Promo codes: checking a new code's fields and turning stored codes into list rows. Pure, so every rule is
 * unit-tested; the server (promo-admin.ts) and the database CHECK constraints enforce the same limits again.
 *
 * Dates are campus days (Africa/Lagos, UTC+1, no daylight saving): "valid from" starts at 00:00 that day and "valid
 * until" includes the whole day (the stored end is 00:00 the next day, exclusive).
 */
import { describePromo, normalizePromoCode, type PromoType } from "./promo-rules";

export const PROMO_LIMITS = {
  maxFixed: 1_000_000,
  maxCap: 1_000_000,
  maxMinSubtotal: 10_000_000,
  maxUses: 1_000_000,
  maxUsesPerStudent: 100,
} as const;

export type NewPromoCode = {
  code: string;
  type: PromoType;
  value: number;
  maxDiscount: number | null;
  minSubtotal: number;
  maxUses: number | null;
  maxUsesPerStudent: number;
  startsAt: Date | null;
  endsAt: Date | null;
};

type Field = keyof NewPromoCode | "startsOn" | "endsOn";
type Parsed<T> = { ok: true; data: T } | { ok: false; field?: Field; error: string };

const CAMPUS_OFFSET_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

const blank = (value: unknown) => value === undefined || value === null || (typeof value === "string" && !value.trim());

/** Whole naira from a number or a digits-only string; null when blank; NaN when not a whole number. */
function wholeNumber(value: unknown): number | null {
  if (blank(value)) return null;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : Number.NaN;
  if (typeof value === "string" && /^\d{1,9}$/.test(value.trim().replace(/,/g, ""))) return Number(value.trim().replace(/,/g, ""));
  return Number.NaN;
}

/** "2026-11-30" → that campus day's midnight, or null when blank; NaN-dated when invalid. */
function campusDay(value: unknown): Date | null | "invalid" {
  if (blank(value)) return null;
  if (typeof value !== "string") return "invalid";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return "invalid";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return "invalid";
  return new Date(utc - CAMPUS_OFFSET_MS);
}

/** Checks the create form. Numbers may arrive as strings (form fields); commas are allowed ("1,000"). */
export function parseNewPromoCode(body: unknown, now: Date = new Date()): Parsed<NewPromoCode> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  const input = body as Record<string, unknown>;

  const code = normalizePromoCode(input.code);
  if (!code) return { ok: false, field: "code", error: "Use 3–20 letters and numbers, no spaces or symbols (e.g. WELCOME1K)." };

  const type = input.type;
  if (type !== "PERCENT" && type !== "FIXED") return { ok: false, field: "type", error: "Choose % off or naira off." };

  const value = wholeNumber(input.value);
  if (type === "PERCENT" && (value === null || !Number.isSafeInteger(value) || value < 1 || value > 100)) {
    return { ok: false, field: "value", error: "Enter a percentage from 1 to 100." };
  }
  if (type === "FIXED" && (value === null || !Number.isSafeInteger(value) || value < 1 || value > PROMO_LIMITS.maxFixed)) {
    return { ok: false, field: "value", error: `Enter an amount from ₦1 to ${naira(PROMO_LIMITS.maxFixed)}.` };
  }

  const maxDiscount = wholeNumber(input.maxDiscount);
  if (maxDiscount !== null) {
    if (type === "FIXED") return { ok: false, field: "maxDiscount", error: "A cap only applies to % off codes. Leave it empty." };
    if (!Number.isSafeInteger(maxDiscount) || maxDiscount < 1 || maxDiscount > PROMO_LIMITS.maxCap) return { ok: false, field: "maxDiscount", error: `Enter a cap from ₦1 to ${naira(PROMO_LIMITS.maxCap)}, or leave it empty.` };
  }

  const minSubtotal = wholeNumber(input.minSubtotal) ?? 0;
  if (!Number.isSafeInteger(minSubtotal) || minSubtotal < 0 || minSubtotal > PROMO_LIMITS.maxMinSubtotal) {
    return { ok: false, field: "minSubtotal", error: `Enter a minimum from ₦0 to ${naira(PROMO_LIMITS.maxMinSubtotal)}, or leave it empty.` };
  }

  const maxUses = wholeNumber(input.maxUses);
  if (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > PROMO_LIMITS.maxUses)) {
    return { ok: false, field: "maxUses", error: "Enter how many times it can be used in total, or leave it empty for no limit." };
  }

  const maxUsesPerStudent = wholeNumber(input.maxUsesPerStudent) ?? 1;
  if (!Number.isSafeInteger(maxUsesPerStudent) || maxUsesPerStudent < 1 || maxUsesPerStudent > PROMO_LIMITS.maxUsesPerStudent) {
    return { ok: false, field: "maxUsesPerStudent", error: `Enter uses per student from 1 to ${PROMO_LIMITS.maxUsesPerStudent}.` };
  }

  const startsAt = campusDay(input.startsOn);
  if (startsAt === "invalid") return { ok: false, field: "startsOn", error: "Pick a valid start date, or leave it empty." };
  const endsOn = campusDay(input.endsOn);
  if (endsOn === "invalid") return { ok: false, field: "endsOn", error: "Pick a valid end date, or leave it empty." };
  // "Valid until 30 Nov" includes the whole of 30 Nov.
  const endsAt = endsOn ? new Date(endsOn.getTime() + DAY_MS) : null;
  if (startsAt && endsAt && endsAt <= startsAt) return { ok: false, field: "endsOn", error: "The end date must be on or after the start date." };
  if (endsAt && endsAt <= now) return { ok: false, field: "endsOn", error: "The end date has already passed." };

  return { ok: true, data: { code, type, value: value!, maxDiscount: type === "PERCENT" ? maxDiscount : null, minSubtotal, maxUses, maxUsesPerStudent, startsAt, endsAt } };
}

/** Pausing or resuming a code: body { active: boolean }. */
export function parsePromoActiveChange(body: unknown): Parsed<{ active: boolean }> {
  if (!body || typeof body !== "object" || typeof (body as { active?: unknown }).active !== "boolean") return { ok: false, error: "Say whether the code should be active." };
  return { ok: true, data: { active: (body as { active: boolean }).active } };
}

export type PromoStatus = "LIVE" | "PAUSED" | "SCHEDULED" | "EXPIRED" | "USED_UP";

export type AdminPromoSource = NewPromoCode & { id: string; active: boolean; createdAt: Date; createdByName: string; uses: number; discountGiven: number };

export type AdminPromoRow = {
  id: string;
  code: string;
  active: boolean;
  status: PromoStatus;
  statusLabel: string;
  /** "₦1,000 off your items". */
  offer: string;
  /** "Items from ₦5,000 · 1 per student · 100 uses in total". */
  conditions: string;
  /** "Valid until 30 Nov 2026", "Always valid". */
  window: string;
  /** "12 of 100 used · ₦12,000 given", counting paid checkouts only. */
  usage: string;
  createdLabel: string;
};

const STATUS_LABELS: Record<PromoStatus, string> = { LIVE: "Live", PAUSED: "Paused", SCHEDULED: "Scheduled", EXPIRED: "Expired", USED_UP: "Used up" };

const campusDate = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

export function promoStatus(code: Pick<AdminPromoSource, "active" | "startsAt" | "endsAt" | "maxUses" | "uses">, now: Date): PromoStatus {
  if (!code.active) return "PAUSED";
  if (code.endsAt && now >= code.endsAt) return "EXPIRED";
  if (code.maxUses !== null && code.uses >= code.maxUses) return "USED_UP";
  if (code.startsAt && now < code.startsAt) return "SCHEDULED";
  return "LIVE";
}

export function adminPromoRow(code: AdminPromoSource, now: Date = new Date()): AdminPromoRow {
  const status = promoStatus(code, now);
  const conditions = [
    code.minSubtotal > 0 ? `Items from ${naira(code.minSubtotal)}` : "Any order",
    code.maxUsesPerStudent === 1 ? "1 use per student" : `${code.maxUsesPerStudent} uses per student`,
    code.maxUses === null ? "No total limit" : `${code.maxUses.toLocaleString("en-NG")} uses in total`,
  ].join(" · ");
  // The stored end is exclusive (00:00 the next day): show the last whole day.
  const lastDay = code.endsAt ? new Date(code.endsAt.getTime() - 1) : null;
  const window = code.startsAt && lastDay ? `${campusDate(code.startsAt)} – ${campusDate(lastDay)}` : code.startsAt ? `From ${campusDate(code.startsAt)}` : lastDay ? `Until ${campusDate(lastDay)}` : "No end date";
  const used = code.maxUses === null ? `${code.uses.toLocaleString("en-NG")} used` : `${code.uses.toLocaleString("en-NG")} of ${code.maxUses.toLocaleString("en-NG")} used`;
  return {
    id: code.id,
    code: code.code,
    active: code.active,
    status,
    statusLabel: STATUS_LABELS[status],
    offer: describePromo(code),
    conditions,
    window,
    usage: `${used} · ${naira(code.discountGiven)} given`,
    createdLabel: `Created ${campusDate(code.createdAt)} by ${code.createdByName}`,
  };
}
