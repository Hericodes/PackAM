import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPaymentPollDelay, PAYMENT_POLL_STOP_AFTER_MS } from "./payment-polling";

test("payment polling backs off and stops after five minutes", () => {
  assert.equal(nextPaymentPollDelay(0), 5_000);
  assert.equal(nextPaymentPollDelay(45_000), 10_000);
  assert.equal(nextPaymentPollDelay(3 * 60_000), 30_000);
  assert.equal(nextPaymentPollDelay(PAYMENT_POLL_STOP_AFTER_MS), null);
});

test("polling stays well under the status route's 15-per-minute limit", () => {
  let elapsed = 0;
  const checksAt: number[] = [0];
  for (let delay = nextPaymentPollDelay(elapsed); delay !== null; delay = nextPaymentPollDelay(elapsed)) {
    elapsed += delay;
    checksAt.push(elapsed);
  }
  for (const start of checksAt) {
    const inWindow = checksAt.filter((at) => at >= start && at < start + 60_000).length;
    // Leaves room for a manual "Check again" and a second tab.
    assert.ok(inWindow <= 12, `${inWindow} checks in the minute from ${start}ms`);
  }
  assert.ok(checksAt.length < 30, `total checks ${checksAt.length}`);
});
