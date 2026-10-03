import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionSupportCase } from "./support-policy";

test("support triage follows open, investigation, resolution, close order", () => {
  assert.equal(canTransitionSupportCase("OPEN", "IN_PROGRESS"), true);
  assert.equal(canTransitionSupportCase("IN_PROGRESS", "RESOLVED"), true);
  assert.equal(canTransitionSupportCase("IN_PROGRESS", "ESCALATED"), true);
  assert.equal(canTransitionSupportCase("ESCALATED", "IN_PROGRESS"), true);
  assert.equal(canTransitionSupportCase("RESOLVED", "CLOSED"), true);
  assert.equal(canTransitionSupportCase("OPEN", "CLOSED"), false);
  assert.equal(canTransitionSupportCase("CLOSED", "OPEN"), false);
});
