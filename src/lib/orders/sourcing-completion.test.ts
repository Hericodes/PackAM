import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCompleteSourcing, hasUnresolvedUnavailableItems } from "./sourcing-completion";

test("delivery readiness requires every ordered unit to be sourced or approved", () => {
  assert.equal(hasCompleteSourcing([{ quantity: 2, sourcing: [{ status: "SOURCED", quantity: 1 }, { status: "APPROVED", quantity: 1 }] }]), true);
  assert.equal(hasCompleteSourcing([{ quantity: 2, sourcing: [{ status: "SOURCED", quantity: 1 }, { status: "PRICE_PENDING", quantity: 1 }] }]), false);
  assert.equal(hasCompleteSourcing([{ quantity: 1, sourcing: [{ status: "UNAVAILABLE", quantity: 0 }] }]), false);
});

test("a required quantity still unavailable is distinguished for refund handling", () => {
  assert.equal(hasUnresolvedUnavailableItems([{ quantity: 2, sourcing: [{ status: "SOURCED", quantity: 1 }, { status: "UNAVAILABLE", quantity: 0 }] }]), true);
  assert.equal(hasUnresolvedUnavailableItems([{ quantity: 1, sourcing: [{ status: "SOURCED", quantity: 1 }, { status: "UNAVAILABLE", quantity: 0 }] }]), false);
});
