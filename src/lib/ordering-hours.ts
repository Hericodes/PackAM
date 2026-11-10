/**
 * When students can place orders: Monday to Friday, 8am to 5pm campus time (Africa/Lagos, UTC+1 all year,
 * no daylight saving). Outside those times students can still browse, build plates and fill their cart;
 * only starting a payment is refused (shop and food checkout, and printing).
 *
 * Both can be changed without a code change:
 * - ORDERING_HOURS: "HH:MM-HH:MM" in campus time, e.g. "08:00-17:00"; "00:00-24:00" means all day.
 * - ORDERING_DAYS: days and ranges, e.g. "MON-FRI", "MON-SAT", "MON,WED,FRI"; "SUN-SAT" means every day.
 * Unset or invalid means the default (8am–5pm, Monday to Friday). The opening minute is included and the
 * closing minute is not: at 5:00pm ordering is closed.
 *
 * One-off closed days (e.g. a day of mourning) are listed in src/config/ordering-closures.ts: on those campus dates
 * ordering stays closed all day, and the closed notices give the reason.
 *
 * Pure (the time and settings are passed in), so every edge is unit-tested. Safe in the browser too:
 * client components get the settings and the server's time as props, never from process.env.
 */

import { ORDERING_CLOSURES } from "../config/ordering-closures";

/** 0 = Sunday … 6 = Saturday, in campus time. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type OrderingHours = {
  /** Minutes after campus midnight when ordering opens (0–1439). */
  opensAtMinute: number;
  /** Minutes after campus midnight when ordering closes (opensAtMinute+1 – 1440). */
  closesAtMinute: number;
  /** The days ordering opens at all, sorted, never empty. */
  days: readonly Weekday[];
  /** Campus dates with no ordering at all, whatever `days` says (only today's and later ones are kept). */
  closures?: readonly OrderingClosure[];
};

/** A whole campus day without ordering: `date` is "YYYY-MM-DD" in campus time; `note` is the sentence shown. */
export type OrderingClosure = { date: string; note: string };

const MONDAY_TO_FRIDAY: readonly Weekday[] = [1, 2, 3, 4, 5];
const EVERY_DAY: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_ORDERING_HOURS: OrderingHours = { opensAtMinute: 8 * 60, closesAtMinute: 17 * 60, days: MONDAY_TO_FRIDAY };

/** Lagos is UTC+1 all year. */
const CAMPUS_UTC_OFFSET_MINUTES = 60;
const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;
const DAY_MS = DAY_MINUTES * MINUTE_MS;
/** 1 January 1970 was a Thursday. */
const EPOCH_WEEKDAY = 4;

const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const CLOCK = /^([01]\d|2[0-4]):([0-5]\d)$/;

function parseClock(value: string) {
  const match = CLOCK.exec(value.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute <= DAY_MINUTES ? minute : null;
}

/** "08:00-17:00" → { opensAtMinute: 480, closesAtMinute: 1020 }. Null when malformed or the window is empty. */
export function parseOrderingWindow(raw: string | null | undefined): Pick<OrderingHours, "opensAtMinute" | "closesAtMinute"> | null {
  if (typeof raw !== "string") return null;
  const [open, close, extra] = raw.split("-");
  if (open === undefined || close === undefined || extra !== undefined) return null;
  const opensAtMinute = parseClock(open);
  const closesAtMinute = parseClock(close);
  if (opensAtMinute === null || closesAtMinute === null || opensAtMinute >= closesAtMinute || opensAtMinute >= DAY_MINUTES) return null;
  return { opensAtMinute, closesAtMinute };
}

function parseDayCode(value: string) {
  const index = DAY_CODES.indexOf(value.trim().toUpperCase() as (typeof DAY_CODES)[number]);
  return index < 0 ? null : (index as Weekday);
}

/** "MON-FRI" → [1,2,3,4,5]; "MON,WED,FRI" → [1,3,5]; "FRI-MON" wraps → [0,1,5,6]. Null when malformed or empty. */
export function parseOrderingDays(raw: string | null | undefined): Weekday[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const days = new Set<Weekday>();
  for (const part of raw.split(",")) {
    const [from, to, extra] = part.split("-");
    if (from === undefined || extra !== undefined) return null;
    const start = parseDayCode(from);
    const end = to === undefined ? start : parseDayCode(to);
    if (start === null || end === null) return null;
    for (let day = start; ; day = ((day + 1) % 7) as Weekday) {
      days.add(day);
      if (day === end) break;
    }
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * The server's ordering times: ORDERING_HOURS and ORDERING_DAYS when valid, else 8am–5pm, Monday to Friday, plus the
 * closed days from today on (`closures` is left out when there are none).
 */
export function orderingHoursFromEnv(
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now(),
  closures: readonly OrderingClosure[] = ORDERING_CLOSURES,
): OrderingHours {
  const window = (env.ORDERING_HOURS?.trim() && parseOrderingWindow(env.ORDERING_HOURS)) || DEFAULT_ORDERING_HOURS;
  const days = (env.ORDERING_DAYS?.trim() && parseOrderingDays(env.ORDERING_DAYS)) || DEFAULT_ORDERING_HOURS.days;
  const today = campusDateKey(campusDayNumber(new Date(now)));
  const upcoming = closures.filter((closure) => DATE_KEY.test(closure.date) && closure.date >= today);
  return { opensAtMinute: window.opensAtMinute, closesAtMinute: window.closesAtMinute, days, ...(upcoming.length ? { closures: upcoming } : {}) };
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Days since 1 January 1970, in campus time. */
function campusDayNumber(now: Date) {
  return Math.floor((now.getTime() + CAMPUS_UTC_OFFSET_MINUTES * MINUTE_MS) / DAY_MS);
}

/** "2026-11-11" for a campus day number. */
function campusDateKey(campusDay: number) {
  return new Date(campusDay * DAY_MS).toISOString().slice(0, 10);
}

/** The closure covering `now`'s campus day, or null on an ordinary day. */
export function closureOn(hours: OrderingHours, now: Date): OrderingClosure | null {
  const key = campusDateKey(campusDayNumber(now));
  return hours.closures?.find((closure) => closure.date === key) ?? null;
}

export function isAlwaysOpen(hours: OrderingHours) {
  return hours.opensAtMinute === 0 && hours.closesAtMinute === DAY_MINUTES && EVERY_DAY.every((day) => hours.days.includes(day));
}

export type OrderingStatus =
  | { open: true; /** When ordering closes; null when it never does. */ closesAt: Date | null }
  | {
      open: false;
      /** The next time ordering opens. */ opensAt: Date;
      /** It opens later on the same campus day. */ opensToday: boolean;
      /** Set when a closed day (today or before the next opening) explains part of the wait. */ note?: string;
    };

export function orderingStatus(now: Date, hours: OrderingHours = DEFAULT_ORDERING_HOURS): OrderingStatus {
  const campusDay = campusDayNumber(now);
  const closures = hours.closures ?? [];
  const closureAt = (dayOffset: number) => {
    if (!closures.length) return null;
    const key = campusDateKey(campusDay + dayOffset);
    return closures.find((closure) => closure.date === key) ?? null;
  };
  if (isAlwaysOpen(hours) && !closures.some((closure) => closure.date >= campusDateKey(campusDay))) return { open: true, closesAt: null };
  const campusMs = now.getTime() + CAMPUS_UTC_OFFSET_MINUTES * MINUTE_MS;
  const campusMidnightMs = campusDay * DAY_MS;
  const minuteOfDay = (campusMs - campusMidnightMs) / MINUTE_MS;
  const today = ((campusDay + EPOCH_WEEKDAY) % 7) as Weekday;
  const at = (dayOffset: number, minute: number) => new Date(campusMidnightMs + dayOffset * DAY_MS + minute * MINUTE_MS - CAMPUS_UTC_OFFSET_MINUTES * MINUTE_MS);

  if (hours.days.includes(today) && !closureAt(0) && minuteOfDay >= hours.opensAtMinute && minuteOfDay < hours.closesAtMinute) {
    return { open: true, closesAt: at(0, hours.closesAtMinute) };
  }
  // The next opening: later today if today is an ordering day and it hasn't opened yet, else the next ordering day.
  // Closed days are skipped; the first one passed over gives the note.
  let note: string | undefined;
  for (let offset = 0; offset <= 7 + closures.length; offset += 1) {
    const day = ((today + offset) % 7) as Weekday;
    const closure = closureAt(offset);
    if (closure) {
      note ??= closure.note;
      continue;
    }
    if (!hours.days.includes(day) || (offset === 0 && minuteOfDay >= hours.opensAtMinute)) continue;
    return { open: false, opensAt: at(offset, hours.opensAtMinute), opensToday: offset === 0, ...(note ? { note } : {}) };
  }
  // Unreachable while days is never empty; fail safe (closed, retry in a day) rather than open.
  return { open: false, opensAt: at(1, hours.opensAtMinute), opensToday: false, ...(note ? { note } : {}) };
}

/** When the status next flips (for client timers), or null when it never does. */
export function nextOrderingChange(status: OrderingStatus) {
  return status.open ? status.closesAt : status.opensAt;
}

/** 480 → "8am", 1020 → "5pm", 510 → "8:30am", 720 → "12 noon", 0 or 1440 → "midnight". */
export function formatCampusClock(minute: number) {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (m === 0) return "midnight";
  if (m === 12 * 60) return "12 noon";
  const hour24 = Math.floor(m / 60);
  const minutes = m % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${hour24 < 12 ? "am" : "pm"}`;
}

/** "8am–5pm", or "all day". */
export function orderingTimeLabel(hours: OrderingHours) {
  return hours.opensAtMinute === 0 && hours.closesAtMinute === DAY_MINUTES ? "all day" : `${formatCampusClock(hours.opensAtMinute)}–${formatCampusClock(hours.closesAtMinute)}`;
}

/** "Monday to Friday", "every day", or a list such as "Monday, Wednesday and Friday" (weeks start on Monday). */
export function orderingDaysLabel(days: readonly Weekday[]) {
  if (EVERY_DAY.every((day) => days.includes(day))) return "every day";
  const mondayFirst = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const positions = mondayFirst.map((day) => (day + 6) % 7);
  const consecutive = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  const names = mondayFirst.map((day) => DAY_NAMES[day]);
  if (names.length >= 3 && consecutive) return `${names[0]} to ${names[names.length - 1]}`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Monday to Friday, 8am–5pm". */
export function orderingHoursLabel(hours: OrderingHours) {
  return `${orderingDaysLabel(hours.days)}, ${orderingTimeLabel(hours)}`;
}

/**
 * When ordering opens next, to finish a sentence: "at 8am" later the same day, else "Monday at 8am".
 * A weekday name, never "tomorrow", so a page left open past midnight never says something wrong.
 */
export function openingPhrase(status: Extract<OrderingStatus, { open: false }>, hours: OrderingHours) {
  const clock = formatCampusClock(hours.opensAtMinute);
  if (status.opensToday) return `at ${clock}`;
  const weekday = (Math.floor((status.opensAt.getTime() + CAMPUS_UTC_OFFSET_MINUTES * MINUTE_MS) / DAY_MS) + EPOCH_WEEKDAY) % 7;
  return `${DAY_NAMES[weekday]} at ${clock}`;
}

/** The sentence shown wherever ordering is refused. */
export function orderingClosedMessage(hours: OrderingHours, status: Extract<OrderingStatus, { open: false }>) {
  return `Ordering is closed right now.${status.note ? ` ${status.note}` : ""} PackAM takes orders ${orderingHoursLabel(hours)}, and opens again ${openingPhrase(status, hours)}.`;
}

/** Starting a payment outside ordering times. Nothing was created or charged. */
export class OrderingClosedError extends Error {
  readonly opensAt: Date;
  constructor(readonly hours: OrderingHours, status: Extract<OrderingStatus, { open: false }>) {
    super(orderingClosedMessage(hours, status));
    this.name = "OrderingClosedError";
    this.opensAt = status.opensAt;
  }
}

/** Throws OrderingClosedError outside ordering times. Call it only where a new payment would be created. */
export function assertOrderingOpen(now: Date = new Date(), hours: OrderingHours = orderingHoursFromEnv()) {
  const status = orderingStatus(now, hours);
  if (!status.open) throw new OrderingClosedError(hours, status);
}

/** What a page hands its client components: the settings and the server's clock, so phones with a wrong clock agree. */
export type OrderingClock = { hours: OrderingHours; serverNow: number };

export function orderingClock(env: Record<string, string | undefined> = process.env, now: number = Date.now()): OrderingClock {
  return { hours: orderingHoursFromEnv(env, now), serverNow: now };
}

/** The body every route returns for a refused payment, so checkout and printing handle it the same way. */
export function orderingClosedBody(error: OrderingClosedError, kept: "cart" | "print job" = "cart") {
  return { error: `${error.message} Your ${kept} is saved, and nothing has been charged.`, code: "ORDERING_CLOSED", opensAt: error.opensAt.toISOString() } as const;
}
