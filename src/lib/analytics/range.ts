/**
 * Date ranges for admin analytics, in campus time (Africa/Lagos, UTC+1, no daylight saving). Pure, so the
 * presets, custom ranges, comparison periods and chart buckets are unit-tested.
 *
 * A range is [from, to): from is the start of the first day, to is the start of the day after the last.
 */

export const CAMPUS_OFFSET_MS = 60 * 60 * 1000; // UTC+1
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_CUSTOM_DAYS = 366;

export const PRESETS = ["today", "7d", "30d", "90d"] as const;
export type Preset = (typeof PRESETS)[number];

export type AnalyticsRange = {
  key: string;
  label: string;
  from: Date;
  to: Date;
  /** The same length immediately before, for comparisons. */
  previousFrom: Date;
  previousTo: Date;
  /** Chart buckets: hourly for a single day, daily otherwise. */
  bucket: "hour" | "day";
  /** Campus dates, YYYY-MM-DD, first and last day included. */
  fromDay: string;
  toDay: string;
};

/** The campus calendar day (YYYY-MM-DD) of an instant. */
export function campusDay(at: Date) {
  return new Date(at.getTime() + CAMPUS_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a campus day starts. */
export function campusDayStart(day: string) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - CAMPUS_OFFSET_MS);
}

function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function isRealDay(day: string) {
  return DAY_PATTERN.test(day) && new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;
}

function build(key: string, label: string, fromDay: string, toDay: string): AnalyticsRange {
  const from = campusDayStart(fromDay);
  const to = campusDayStart(addDays(toDay, 1));
  const span = to.getTime() - from.getTime();
  return { key, label, from, to, previousFrom: new Date(from.getTime() - span), previousTo: from, bucket: span <= DAY_MS ? "hour" : "day", fromDay, toDay };
}

const PRESET_LABELS: Record<Preset, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };

/**
 * Reads ?range=today|7d|30d|90d or ?from=YYYY-MM-DD&to=YYYY-MM-DD. "Last N days" includes today. A custom
 * range may not end in the future or exceed a year. Anything invalid is an error, never a silent default.
 */
export function parseRange(params: { range?: string | null; from?: string | null; to?: string | null }, now: Date): { ok: true; range: AnalyticsRange } | { ok: false; error: string } {
  const today = campusDay(now);
  if (params.from || params.to) {
    const fromDay = params.from ?? "";
    const toDay = params.to ?? "";
    if (!isRealDay(fromDay) || !isRealDay(toDay)) return { ok: false, error: "Choose a start and end date." };
    if (fromDay > toDay) return { ok: false, error: "The start date must be on or before the end date." };
    if (toDay > today) return { ok: false, error: "The end date can’t be in the future." };
    const days = (Date.parse(toDay) - Date.parse(fromDay)) / DAY_MS + 1;
    if (days > MAX_CUSTOM_DAYS) return { ok: false, error: `Choose a range of up to ${MAX_CUSTOM_DAYS} days.` };
    return { ok: true, range: build(`${fromDay}_${toDay}`, `${fromDay} to ${toDay}`, fromDay, toDay) };
  }
  const preset = (params.range ?? "30d") as Preset;
  if (!PRESETS.includes(preset)) return { ok: false, error: "Unknown date range." };
  const days = preset === "today" ? 1 : Number(preset.slice(0, -1));
  return { ok: true, range: build(preset, PRESET_LABELS[preset], addDays(today, -(days - 1)), today) };
}

/** Every bucket key in the range, so days with nothing still appear (as 0, or as "no data" before tracking began). */
export function bucketKeys(range: AnalyticsRange) {
  const keys: string[] = [];
  if (range.bucket === "hour") {
    for (let h = 0; h < 24; h += 1) keys.push(`${range.fromDay} ${String(h).padStart(2, "0")}:00`);
    return keys;
  }
  for (let day = range.fromDay; day <= range.toDay; day = addDays(day, 1)) keys.push(day);
  return keys;
}

/** Joins sparse database rows onto every bucket. */
export function fillSeries(range: AnalyticsRange, rows: Array<{ bucket: string; value: number }>) {
  const byKey = new Map(rows.map((row) => [row.bucket, row.value]));
  return bucketKeys(range).map((bucket) => ({ bucket, value: byKey.get(bucket) ?? 0 }));
}

/** A share as a percentage with one decimal, or null when there's nothing to divide by. */
export function rate(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/**
 * Change versus the previous period, in percent. Null when the previous period had nothing (a percentage
 * of zero means nothing) or when it isn't comparable (e.g. visitor tracking hadn't started yet).
 */
export function change(current: number, previous: number, comparable = true) {
  if (!comparable || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
