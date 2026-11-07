import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ORDERING_HOURS,
  OrderingClosedError,
  assertOrderingOpen,
  formatCampusClock,
  nextOrderingChange,
  openingPhrase,
  orderingClosedBody,
  orderingDaysLabel,
  orderingHoursFromEnv,
  orderingHoursLabel,
  orderingStatus,
  parseOrderingDays,
  parseOrderingWindow,
  type OrderingHours,
  type OrderingStatus,
} from "./ordering-hours";

/** A moment given in campus time (Lagos, UTC+1). Week of 9–15 November 2026: Monday 9th … Sunday 15th. */
const lagos = (iso: string) => new Date(`${iso}+01:00`);
const closed = (status: OrderingStatus) => {
  assert.equal(status.open, false);
  return status as Extract<OrderingStatus, { open: false }>;
};

test("ordering is open Monday to Friday from 8:00am up to, but not including, 5:00pm campus time", () => {
  assert.equal(orderingStatus(lagos("2026-11-09T07:59:59")).open, false, "Monday, a second before 8am");
  assert.equal(orderingStatus(lagos("2026-11-09T08:00:00")).open, true, "Monday 8am sharp");
  assert.equal(orderingStatus(lagos("2026-11-11T12:30:00")).open, true, "Wednesday lunchtime");
  assert.equal(orderingStatus(lagos("2026-11-13T16:59:59")).open, true, "Friday, a second before 5pm");
  assert.equal(orderingStatus(lagos("2026-11-13T17:00:00")).open, false, "Friday 5pm sharp is closed");
  assert.equal(orderingStatus(lagos("2026-11-10T23:30:00")).open, false, "Tuesday night");
});

test("weekends are closed all day", () => {
  for (const time of ["00:00:00", "08:00:00", "12:00:00", "16:59:59"]) {
    assert.equal(orderingStatus(lagos(`2026-11-14T${time}`)).open, false, `Saturday ${time}`);
    assert.equal(orderingStatus(lagos(`2026-11-15T${time}`)).open, false, `Sunday ${time}`);
  }
});

test("campus time, not the server's or the phone's", () => {
  assert.equal(orderingStatus(new Date("2026-11-09T07:30:00Z")).open, true, "7:30am UTC Monday is 8:30am in Lagos");
  assert.equal(orderingStatus(new Date("2026-11-09T16:30:00Z")).open, false, "4:30pm UTC is 5:30pm in Lagos");
  assert.equal(orderingStatus(new Date("2026-11-13T23:30:00Z")).open, false, "11:30pm UTC Friday is already Saturday in Lagos");
  assert.equal(orderingStatus(new Date("2026-11-15T23:30:00Z")).open, false, "Sunday 11:30pm UTC is Monday 12:30am in Lagos: before opening");
});

test("when closed, it says when ordering opens next", () => {
  const monday = (time: string) => lagos(`2026-11-16T${time}`).toISOString();
  const early = closed(orderingStatus(lagos("2026-11-10T06:15:00")));
  assert.equal(early.opensAt.toISOString(), lagos("2026-11-10T08:00:00").toISOString(), "a weekday before 8am: that morning");
  assert.equal(early.opensToday, true);

  const evening = closed(orderingStatus(lagos("2026-11-10T19:00:00")));
  assert.equal(evening.opensAt.toISOString(), lagos("2026-11-11T08:00:00").toISOString(), "a weekday evening: the next morning");
  assert.equal(evening.opensToday, false);

  assert.equal(closed(orderingStatus(lagos("2026-11-13T17:00:00"))).opensAt.toISOString(), monday("08:00:00"), "Friday 5pm: Monday");
  assert.equal(closed(orderingStatus(lagos("2026-11-14T10:00:00"))).opensAt.toISOString(), monday("08:00:00"), "Saturday: Monday");
  assert.equal(closed(orderingStatus(lagos("2026-11-15T23:59:00"))).opensAt.toISOString(), monday("08:00:00"), "late Sunday: Monday");
  // Across a month end, still the next weekday morning.
  assert.equal(closed(orderingStatus(lagos("2026-11-30T21:00:00"))).opensAt.toISOString(), lagos("2026-12-01T08:00:00").toISOString());
});

test("when open, it says when ordering closes; the client timer flips at that moment", () => {
  const status = orderingStatus(lagos("2026-11-12T10:00:00"));
  assert.equal(status.open && status.closesAt?.toISOString(), lagos("2026-11-12T17:00:00").toISOString());
  assert.equal(nextOrderingChange(status)?.toISOString(), lagos("2026-11-12T17:00:00").toISOString());
});

test("ORDERING_HOURS and ORDERING_DAYS change the times; unset or invalid keeps Monday to Friday, 8am–5pm", () => {
  assert.deepEqual(orderingHoursFromEnv({}), DEFAULT_ORDERING_HOURS);
  assert.deepEqual(orderingHoursFromEnv({ ORDERING_HOURS: "  ", ORDERING_DAYS: " " }), DEFAULT_ORDERING_HOURS);
  assert.deepEqual(orderingHoursFromEnv({ ORDERING_HOURS: "07:30-18:00", ORDERING_DAYS: "mon-sat" }), { opensAtMinute: 450, closesAtMinute: 1080, days: [1, 2, 3, 4, 5, 6] });
  for (const bad of ["8-17", "08:00", "17:00-08:00", "08:00-08:00", "08:00-25:00", "24:00-24:00", "08:60-17:00", "08:00-17:00-18:00", "always"]) {
    assert.equal(parseOrderingWindow(bad), null, bad);
    assert.deepEqual(orderingHoursFromEnv({ ORDERING_HOURS: bad }), DEFAULT_ORDERING_HOURS, `${bad} falls back to the default`);
  }
  assert.deepEqual(parseOrderingDays("MON-FRI"), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseOrderingDays("mon, wed ,FRI"), [1, 3, 5]);
  assert.deepEqual(parseOrderingDays("FRI-MON"), [0, 1, 5, 6], "a range can wrap over the weekend");
  assert.deepEqual(parseOrderingDays("SUN-SAT"), [0, 1, 2, 3, 4, 5, 6]);
  for (const bad of ["", "WEEKDAYS", "MON-", "MON-FRI-SAT", "MONDAY", "MON,,FRI", "1-5"]) {
    assert.equal(parseOrderingDays(bad), null, bad);
    if (bad.trim()) assert.deepEqual(orderingHoursFromEnv({ ORDERING_DAYS: bad }).days, DEFAULT_ORDERING_HOURS.days, `${bad} falls back to Monday to Friday`);
  }
});

test("00:00-24:00 on SUN-SAT is always open and never schedules a change; all day on weekdays only still closes at weekends", () => {
  const always: OrderingHours = { ...parseOrderingWindow("00:00-24:00")!, days: parseOrderingDays("SUN-SAT")! };
  for (const at of ["2026-11-14T03:00:00", "2026-11-15T17:00:00", "2026-11-09T23:59:59"]) assert.equal(orderingStatus(lagos(at), always).open, true, at);
  assert.equal(nextOrderingChange(orderingStatus(lagos("2026-11-14T03:00:00"), always)), null);
  assert.equal(orderingHoursLabel(always), "every day, all day");

  const weekdaysAllDay: OrderingHours = { ...always, days: [1, 2, 3, 4, 5] };
  assert.equal(orderingStatus(lagos("2026-11-11T03:00:00"), weekdaysAllDay).open, true);
  assert.equal(orderingStatus(lagos("2026-11-14T12:00:00"), weekdaysAllDay).open, false);
});

test("hours and days read the way students say them", () => {
  assert.equal(formatCampusClock(480), "8am");
  assert.equal(formatCampusClock(1020), "5pm");
  assert.equal(formatCampusClock(510), "8:30am");
  assert.equal(formatCampusClock(720), "12 noon");
  assert.equal(formatCampusClock(0), "midnight");
  assert.equal(formatCampusClock(1440), "midnight");
  assert.equal(orderingDaysLabel([1, 2, 3, 4, 5]), "Monday to Friday");
  assert.equal(orderingDaysLabel([1, 2, 3, 4, 5, 6]), "Monday to Saturday");
  assert.equal(orderingDaysLabel([1, 3, 5]), "Monday, Wednesday and Friday");
  assert.equal(orderingDaysLabel([0, 6]), "Saturday and Sunday");
  assert.equal(orderingDaysLabel([2]), "Tuesday");
  assert.equal(orderingHoursLabel(DEFAULT_ORDERING_HOURS), "Monday to Friday, 8am–5pm");
});

test("the opening is named by weekday, never 'tomorrow', so a page left open overnight stays right", () => {
  const phrase = (iso: string) => openingPhrase(closed(orderingStatus(lagos(iso))), DEFAULT_ORDERING_HOURS);
  assert.equal(phrase("2026-11-10T06:00:00"), "at 8am", "later the same morning");
  assert.equal(phrase("2026-11-10T18:00:00"), "Wednesday at 8am");
  assert.equal(phrase("2026-11-13T18:00:00"), "Monday at 8am", "Friday evening");
  assert.equal(phrase("2026-11-14T09:00:00"), "Monday at 8am", "Saturday");
});

test("payment is refused outside ordering times with a typed error and one response shape", () => {
  assert.doesNotThrow(() => assertOrderingOpen(lagos("2026-11-09T09:00:00"), DEFAULT_ORDERING_HOURS));
  assert.throws(() => assertOrderingOpen(lagos("2026-11-14T11:00:00"), DEFAULT_ORDERING_HOURS), (error: Error) => {
    assert.ok(error instanceof OrderingClosedError);
    assert.equal(error.opensAt.toISOString(), lagos("2026-11-16T08:00:00").toISOString());
    assert.equal(error.message, "Ordering is closed right now. PackAM takes orders Monday to Friday, 8am–5pm, and opens again Monday at 8am.");
    const body = orderingClosedBody(error);
    assert.equal(body.code, "ORDERING_CLOSED");
    assert.match(body.error, /cart is saved, and nothing has been charged/);
    assert.match(orderingClosedBody(error, "print job").error, /print job is saved/);
    return true;
  });
});
