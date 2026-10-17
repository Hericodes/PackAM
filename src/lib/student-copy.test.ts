import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCampusTime, isFinalOrderStatus, orderEventDescription, orderNextStep, orderStatusLabel, orderStatusMessage, orderTimeline } from "./student-copy";

test("a FAILED order is described as a refund problem, never as a failed payment", () => {
  assert.equal(orderStatusLabel("FAILED"), "Refund needs attention");
  const message = orderStatusMessage("FAILED", { total: 1_200 });
  assert.doesNotMatch(message, /payment failed/i);
  assert.match(message, /don’t need to pay again/);
});

test("refund messages state the amount and never claim the refund is complete early", () => {
  const processing = orderStatusMessage("REFUND_PROCESSING", { total: 3_700 });
  assert.match(processing, /₦3,700/);
  assert.match(processing, /started/);
  assert.doesNotMatch(processing, /has been confirmed|is confirmed|refunded/i);
  assert.match(orderStatusMessage("REFUNDED", { total: 3_700 }), /has been confirmed/);
});

test("only an assigned order claims a runner accepted the mission", () => {
  assert.match(orderStatusMessage("RUNNER_ASSIGNED", { total: 1, runnerName: "Tunde" }), /accepted the mission 🫡 Tunde/);
  for (const status of ["PAYMENT_CONFIRMED", "FINDING_RUNNER"]) {
    assert.doesNotMatch(orderStatusMessage(status, { total: 1 }), /accepted/i, status);
  }
});

test("unknown statuses fall back to readable text", () => {
  assert.equal(orderStatusLabel("SOMETHING_NEW"), "something new");
  assert.equal(isFinalOrderStatus("DELIVERED"), true);
  assert.equal(isFinalOrderStatus("OUT_FOR_DELIVERY"), false);
});

test("times are shown in campus (Lagos) time regardless of server timezone", () => {
  // 23:30 UTC is 00:30 the next day in Lagos (UTC+1).
  const formatted = formatCampusTime(new Date("2026-10-13T23:30:00.000Z"));
  assert.match(formatted, /14/);
  assert.match(formatted, /12:30|00:30/);
});

test("order progress marks done, current and upcoming steps", async () => {
  const { orderProgress } = await import("./student-copy");
  assert.deepEqual(orderProgress("SOURCING_PRODUCT")?.map((s) => s.state), ["done", "done", "current", "upcoming", "upcoming"]);
  assert.deepEqual(orderProgress("PAYMENT_CONFIRMED")?.map((s) => s.state), ["current", "upcoming", "upcoming", "upcoming", "upcoming"]);
  assert.ok(orderProgress("DELIVERED")?.every((s) => s.state === "done"));
  for (const status of ["REFUND_PROCESSING", "REFUNDED", "FAILED", "CANCELLED"]) assert.equal(orderProgress(status), null, status);
});

test("timeline is oldest-first and drops consecutive repeats of the same status", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 10, minute));
  const timeline = orderTimeline([
    { status: "RUNNER_ASSIGNED", createdAt: at(5) },
    { status: "PAYMENT_CONFIRMED", createdAt: at(0) },
    { status: "FINDING_RUNNER", createdAt: at(1) },
    { status: "FINDING_RUNNER", createdAt: at(3) },
  ]);
  assert.deepEqual(timeline.map((entry) => entry.status), ["PAYMENT_CONFIRMED", "FINDING_RUNNER", "RUNNER_ASSIGNED"]);
});

test("next-step copy never promises a delivery time or refund outcome", () => {
  for (const status of ["PAYMENT_CONFIRMED", "FINDING_RUNNER", "RUNNER_ASSIGNED", "SOURCING_PRODUCT", "OUT_FOR_DELIVERY", "DELIVERED", "REFUND_PROCESSING", "REFUNDED", "FAILED", "CANCELLED"]) {
    const next = orderNextStep(status);
    assert.ok(next, status);
    assert.doesNotMatch(next, /\d+\s*(min|minute|hour|day)s?/i);
    assert.ok(orderEventDescription(status), status);
  }
  assert.doesNotMatch(orderNextStep("REFUND_PROCESSING") ?? "", /has been confirmed|refund is complete/i);
  assert.equal(orderNextStep("SOMETHING_NEW"), null);
});
