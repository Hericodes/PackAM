import assert from "node:assert/strict";
import { test } from "node:test";
import * as trackingPolicy from "./tracking-policy";
const { studentPrintProgress } = trackingPolicy;

const states = (status: string, reached: string[] = []) => studentPrintProgress(status, reached).steps.map((step) => step.state);

test("student progress marks completed, current and upcoming print steps", () => {
  assert.deepEqual(states("PRINTING"), ["done", "done", "done", "current", "upcoming", "upcoming", "upcoming"]);
  assert.deepEqual(states("FINDING_RUNNER"), ["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
});

test("delivery completion is shown as the final, terminal state", () => {
  const progress = studentPrintProgress("DELIVERED");
  assert.ok(progress.steps.every((step) => step.state === "done"));
  assert.equal(progress.isTerminal, true);
  assert.equal(progress.issue, null);
});

test("issue states keep reached steps and explain what happens next", () => {
  const progress = studentPrintProgress("PRINT_FAILED", ["FINDING_RUNNER", "RUNNER_ASSIGNED", "DOCUMENT_RECEIVED", "PRINTING", "PRINT_FAILED"]);
  assert.deepEqual(progress.steps.map((step) => step.state), ["done", "done", "done", "done", "upcoming", "upcoming", "upcoming"]);
  assert.match(progress.issue?.message ?? "", /operations is reviewing/i);
  assert.equal(progress.isTerminal, false);
  assert.match(studentPrintProgress("REFUND_PROCESSING").issue?.message ?? "", /refund is being processed/i);
});

test("every print status has a student-friendly label, not a raw code", () => {
  const { printStatusLabel } = trackingPolicy;
  for (const status of ["DRAFT", "READY_FOR_PAYMENT", "PAYMENT_CONFIRMED", "FINDING_RUNNER", "RUNNER_ASSIGNED", "DOCUMENT_RECEIVED", "PRINTING", "PRINTED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "DOCUMENT_UNREADABLE", "PRINT_FAILED", "REFUND_PROCESSING", "REFUNDED", "FAILED"]) {
    assert.doesNotMatch(printStatusLabel(status), /_|^[A-Z ]+$/, status);
  }
  assert.equal(printStatusLabel("OUT_FOR_DELIVERY"), "On the way");
});
