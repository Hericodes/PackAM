import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ORDERING_HOURS, type OrderingHours } from "../ordering-hours";
import { MORNING_MESSAGES, bodyParagraphs, campusDayKey, campusDayStart, inSendWindow, morningMessage, parseBroadcastInput, sendWindow, windowStartLabel } from "./campaign-rules";

/** Campus time (Lagos, UTC+1). 9 Nov 2026 is a Monday; 14 Nov a Saturday. */
const lagos = (iso: string) => new Date(`${iso}+01:00`);

test("the good-morning window is 7:30–9:30am on weekdays (30 minutes before opening to 90 after)", () => {
  assert.deepEqual(sendWindow("MORNING", DEFAULT_ORDERING_HOURS), { startMinute: 450, endMinute: 570 });
  assert.equal(windowStartLabel("MORNING", DEFAULT_ORDERING_HOURS), "7:30am");
  assert.equal(inSendWindow("MORNING", DEFAULT_ORDERING_HOURS, lagos("2026-11-09T07:29:59")), false);
  assert.equal(inSendWindow("MORNING", DEFAULT_ORDERING_HOURS, lagos("2026-11-09T07:30:00")), true);
  assert.equal(inSendWindow("MORNING", DEFAULT_ORDERING_HOURS, lagos("2026-11-09T09:29:00")), true);
  assert.equal(inSendWindow("MORNING", DEFAULT_ORDERING_HOURS, lagos("2026-11-09T09:30:00")), false, "never a late good morning");
  assert.equal(inSendWindow("MORNING", DEFAULT_ORDERING_HOURS, lagos("2026-11-14T08:00:00")), false, "not on Saturday");
  assert.equal(inSendWindow("MORNING", DEFAULT_ORDERING_HOURS, lagos("2026-11-15T08:00:00")), false, "not on Sunday");
});

test("the reminder window is 3:30–4:45pm on weekdays (90 to 15 minutes before closing)", () => {
  assert.deepEqual(sendWindow("REMINDER", DEFAULT_ORDERING_HOURS), { startMinute: 930, endMinute: 1005 });
  assert.equal(windowStartLabel("REMINDER", DEFAULT_ORDERING_HOURS), "3:30pm");
  assert.equal(inSendWindow("REMINDER", DEFAULT_ORDERING_HOURS, lagos("2026-11-13T15:29:00")), false);
  assert.equal(inSendWindow("REMINDER", DEFAULT_ORDERING_HOURS, lagos("2026-11-13T15:30:00")), true, "Friday afternoon");
  assert.equal(inSendWindow("REMINDER", DEFAULT_ORDERING_HOURS, lagos("2026-11-13T16:45:00")), false, "too close to closing");
  assert.equal(inSendWindow("REMINDER", DEFAULT_ORDERING_HOURS, lagos("2026-11-14T15:30:00")), false, "not on Saturday");
});

test("no good morning or reminder on a closed day; the days around it are unaffected", () => {
  const hours: OrderingHours = { ...DEFAULT_ORDERING_HOURS, closures: [{ date: "2026-11-11", note: "Closed." }] };
  assert.equal(inSendWindow("MORNING", hours, lagos("2026-11-11T08:00:00")), false);
  assert.equal(inSendWindow("REMINDER", hours, lagos("2026-11-11T15:30:00")), false);
  assert.equal(inSendWindow("REMINDER", hours, lagos("2026-11-10T15:30:00")), true, "the day before");
  assert.equal(inSendWindow("MORNING", hours, lagos("2026-11-12T08:00:00")), true, "the day after");
});

test("the windows follow ORDERING_HOURS and ORDERING_DAYS", () => {
  const longer: OrderingHours = { opensAtMinute: 7 * 60, closesAtMinute: 19 * 60, days: [1, 2, 3, 4, 5, 6] };
  assert.equal(windowStartLabel("MORNING", longer), "6:30am");
  assert.equal(windowStartLabel("REMINDER", longer), "5:30pm");
  assert.equal(inSendWindow("MORNING", longer, lagos("2026-11-14T06:45:00")), true, "Saturdays too, when they're ordering days");
  const allDay: OrderingHours = { opensAtMinute: 0, closesAtMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal(sendWindow("MORNING", allDay), null, "no 'before opening' when it never closes");
  assert.equal(sendWindow("REMINDER", allDay), null);
  assert.equal(inSendWindow("MORNING", allDay, lagos("2026-11-09T08:00:00")), false);
});

test("each scheduled email is keyed by the campus day, so it goes once a day", () => {
  assert.equal(campusDayKey(lagos("2026-11-09T07:30:00")), "2026-11-09");
  assert.equal(campusDayKey(new Date("2026-11-08T23:30:00Z")), "2026-11-09", "11:30pm UTC Sunday is already Monday on campus");
  assert.equal(campusDayStart(lagos("2026-11-09T15:30:00")).toISOString(), lagos("2026-11-09T00:00:00").toISOString());
});

test("the good-morning message rotates by day, the same for everyone on a day", () => {
  const monday = morningMessage(lagos("2026-11-09T07:30:00"));
  assert.equal(morningMessage(lagos("2026-11-09T09:00:00")), monday);
  assert.notEqual(morningMessage(lagos("2026-11-10T07:30:00")), monday);
  const week = new Set(Array.from({ length: MORNING_MESSAGES.length }, (_, day) => morningMessage(lagos(`2026-11-${String(9 + day).padStart(2, "0")}T08:00:00`))));
  assert.equal(week.size, MORNING_MESSAGES.length, "every message gets its turn");
});

test("an announcement needs a subject and message; a button needs both parts and an https link", () => {
  const ok = parseBroadcastInput({ subject: "  New:   Mama Put on PackAM  ", body: "Hello!\r\n\r\nOrder now.", buttonLabel: "Order now", buttonUrl: "https://www.packam.app/food" });
  assert.deepEqual(ok, { ok: true, data: { subject: "New: Mama Put on PackAM", body: "Hello!\n\nOrder now.", buttonLabel: "Order now", buttonUrl: "https://www.packam.app/food" } });
  assert.deepEqual(parseBroadcastInput({ subject: "Hi", body: "Text" }), { ok: true, data: { subject: "Hi", body: "Text", buttonLabel: null, buttonUrl: null } });
  const field = (raw: Record<string, unknown>) => { const parsed = parseBroadcastInput(raw); return parsed.ok ? null : parsed.field; };
  assert.equal(field({ subject: "", body: "x" }), "subject");
  assert.equal(field({ subject: "x".repeat(121), body: "x" }), "subject");
  assert.equal(field({ subject: "x", body: "  " }), "body");
  assert.equal(field({ subject: "x", body: "y", buttonLabel: "Go" }), "buttonUrl");
  assert.equal(field({ subject: "x", body: "y", buttonUrl: "https://packam.app" }), "buttonLabel");
  assert.equal(field({ subject: "x", body: "y", buttonLabel: "Go", buttonUrl: "http://packam.app" }), "buttonUrl", "https only");
  assert.equal(field({ subject: "x", body: "y", buttonLabel: "Go", buttonUrl: "javascript:alert(1)" }), "buttonUrl");
});

test("an announcement's message splits into paragraphs on blank lines", () => {
  assert.deepEqual(bodyParagraphs("First line\nsame paragraph\n\n\nSecond\n  \nThird"), ["First line same paragraph", "Second", "Third"]);
});
