import assert from "node:assert/strict";
import test from "node:test";
import { dayGroup, fullTime, groupByDay, notificationActionLabel, notificationHref, notificationLook, relativeTime } from "./notification-display";

// 14:00 on campus (13:00 UTC), Tuesday 3 November 2026.
const NOW = new Date("2026-11-03T13:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

test("relative times read naturally and turn over at campus midnight", () => {
  assert.equal(relativeTime(ago(20_000), NOW), "Just now");
  assert.equal(relativeTime(ago(5 * MIN), NOW), "5 min ago");
  assert.equal(relativeTime(ago(3 * 60 * MIN), NOW), "3 h ago");
  // 23:30 UTC on 2 Nov is 00:30 on 3 Nov on campus: still today.
  assert.equal(relativeTime(new Date("2026-11-02T23:30:00Z"), NOW), "13 h ago");
  assert.equal(relativeTime(new Date("2026-11-02T22:30:00Z"), NOW), "Yesterday", "23:30 on 2 Nov campus time");
  assert.equal(relativeTime(new Date("2026-10-31T10:00:00Z"), NOW), "Sat");
  assert.equal(relativeTime(new Date("2026-10-12T10:00:00Z"), NOW), "12 Oct");
  assert.equal(relativeTime(new Date("2025-12-24T10:00:00Z"), NOW), "24 Dec 2025");
  assert.equal(relativeTime(new Date(NOW.getTime() + 5 * MIN), NOW), "Just now", "a clock slightly ahead never reads as the future");
  assert.equal(fullTime(new Date("2026-11-03T13:05:00Z")), "Tue 3 Nov, 14:05");
});

test("notifications are grouped Today, Yesterday, This week, Earlier, newest first, with empty groups left out", () => {
  const items = [
    { id: "a", createdAt: "2026-10-01T10:00:00.000Z" },
    { id: "b", createdAt: "2026-11-03T12:00:00.000Z" },
    { id: "c", createdAt: "2026-11-02T12:00:00.000Z" },
    { id: "d", createdAt: "2026-11-03T12:30:00.000Z" },
  ];
  assert.deepEqual(groupByDay(items, NOW).map((g) => [g.group, g.items.map((i) => i.id)]), [["Today", ["d", "b"]], ["Yesterday", ["c"]], ["Earlier", ["a"]]]);
  assert.equal(dayGroup(new Date("2026-10-30T12:00:00Z"), NOW), "This week");
  assert.deepEqual(groupByDay([], NOW), []);
});

test("each notification opens the right page for the reader's role", () => {
  const base = { type: "ORDER", title: "x", orderId: null, relatedType: null, relatedId: null };
  assert.equal(notificationHref({ ...base, orderId: "o1" }, "STUDENT"), "/orders/o1");
  assert.equal(notificationHref({ ...base, orderId: "o1" }, "RUNNER"), "/runner/missions/o1");
  assert.equal(notificationHref({ ...base, orderId: "o1" }, "ADMIN"), "/admin/orders/o1");
  assert.equal(notificationHref({ ...base, relatedType: "PRINT_JOB", relatedId: "p1" }, "STUDENT"), "/printing/jobs/p1");
  assert.equal(notificationHref({ ...base, relatedType: "PRINT_JOB", relatedId: "p1" }, "RUNNER"), "/runner/print-missions/p1");
  assert.equal(notificationHref({ ...base, relatedType: "PRODUCT_REQUEST" }, "ADMIN"), "/admin/requests");
  assert.equal(notificationHref({ ...base, relatedType: "SUPPORT_CASE" }, "STUDENT"), "/support");
  assert.equal(notificationHref({ ...base, type: "PAYMENT" }, "ADMIN"), "/admin/payments", "transfers to confirm");
  assert.equal(notificationHref({ ...base, type: "SYSTEM", relatedType: "USER" }, "ADMIN"), "/admin/payments", "payment PIN alerts");
  assert.equal(notificationHref({ ...base, type: "PAYMENT" }, "STUDENT"), "/cart");
  assert.equal(notificationHref({ ...base, type: "SYSTEM" }, "STUDENT"), null);
  assert.equal(notificationActionLabel("/admin/payments"), "Open payments");
  assert.equal(notificationActionLabel("/orders/o1"), "Open order");
  assert.equal(notificationActionLabel(null), null);
});

test("every type has an icon and a label; unknown types read as a PackAM update", () => {
  for (const type of ["ORDER", "PAYMENT", "DELIVERY", "PRODUCT_REQUEST", "ACCOUNT", "SYSTEM"]) assert.ok(notificationLook(type).icon && notificationLook(type).label, type);
  assert.equal(notificationLook("SOMETHING_NEW").label, "PackAM");
});
