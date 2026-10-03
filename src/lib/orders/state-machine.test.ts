import assert from "node:assert/strict";
import { test } from "node:test";
import { canTransitionOrder } from "./state-machine";

test("successful payment starts finding a runner, then follows fulfilment states", () => {
  assert.equal(canTransitionOrder("PAYMENT_CONFIRMED", "FINDING_RUNNER"), true);
  assert.equal(canTransitionOrder("FINDING_RUNNER", "RUNNER_ASSIGNED"), true);
  assert.equal(canTransitionOrder("RUNNER_ASSIGNED", "SOURCING_PRODUCT"), true);
  assert.equal(canTransitionOrder("SOURCING_PRODUCT", "OUT_FOR_DELIVERY"), true);
  assert.equal(canTransitionOrder("OUT_FOR_DELIVERY", "DELIVERED"), true);
});

test("invalid state jumps and transitions out of terminal states are rejected", () => {
  assert.equal(canTransitionOrder("PAYMENT_CONFIRMED", "DELIVERED"), false);
  assert.equal(canTransitionOrder("FINDING_RUNNER", "OUT_FOR_DELIVERY"), false);
  assert.equal(canTransitionOrder("DELIVERED", "REFUND_PROCESSING"), false);
});
