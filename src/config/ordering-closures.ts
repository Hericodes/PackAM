import type { OrderingClosure } from "../lib/ordering-hours";

/**
 * Whole campus days (Africa/Lagos dates, "YYYY-MM-DD") when PackAM takes no orders at all, whatever ORDERING_HOURS
 * and ORDERING_DAYS say: checkout and printing refuse payment, the "ordering is closed" notices show `note`, and the
 * good-morning and reminder emails aren't sent. Days already past are ignored, so old entries are harmless.
 *
 * `note` is one sentence that reads right both before and on the day, so it names the date.
 */
export const ORDERING_CLOSURES: readonly OrderingClosure[] = [
  { date: "2026-11-11", note: "PackAM is not taking orders on Wednesday, 11 November, in memory of one of our students." },
];
