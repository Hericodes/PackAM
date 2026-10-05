import assert from "node:assert/strict";
import { test } from "node:test";
import { canTransitionPrintJob } from "./status-machine";

test("print job allows only the intended paid runner print and delivery lifecycle", () => {
  const path = [
    ["READY_FOR_PAYMENT", "PAYMENT_CONFIRMED"],
    ["PAYMENT_CONFIRMED", "FINDING_RUNNER"],
    ["FINDING_RUNNER", "RUNNER_ASSIGNED"],
    ["RUNNER_ASSIGNED", "DOCUMENT_RECEIVED"],
    ["DOCUMENT_RECEIVED", "PRINTING"],
    ["PRINTING", "PRINTED"],
    ["PRINTED", "OUT_FOR_DELIVERY"],
    ["OUT_FOR_DELIVERY", "DELIVERED"],
  ] as const;
  for (const [from, to] of path) assert.equal(canTransitionPrintJob(from, to), true, `${from} -> ${to}`);
});

test("terminal, premature, and browser-skippable print job transitions are rejected", () => {
  assert.equal(canTransitionPrintJob("DRAFT", "PRINTING"), false);
  assert.equal(canTransitionPrintJob("RUNNER_ASSIGNED", "DELIVERED"), false);
  assert.equal(canTransitionPrintJob("PRINTING", "OUT_FOR_DELIVERY"), false);
  assert.equal(canTransitionPrintJob("DELIVERED", "REFUND_PROCESSING"), false);
  assert.equal(canTransitionPrintJob("REFUNDED", "RUNNER_ASSIGNED"), false);
});
