import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionSupportCase, supportStatusLabel, supportSubject } from "./support-policy";

test("support triage follows open, investigation, resolution, close order", () => {
  assert.equal(canTransitionSupportCase("OPEN", "IN_PROGRESS"), true);
  assert.equal(canTransitionSupportCase("IN_PROGRESS", "RESOLVED"), true);
  assert.equal(canTransitionSupportCase("IN_PROGRESS", "ESCALATED"), true);
  assert.equal(canTransitionSupportCase("ESCALATED", "IN_PROGRESS"), true);
  assert.equal(canTransitionSupportCase("RESOLVED", "CLOSED"), true);
  assert.equal(canTransitionSupportCase("OPEN", "CLOSED"), false);
  assert.equal(canTransitionSupportCase("CLOSED", "OPEN"), false);
});

test("support subjects combine a known category with an optional summary", () => {
  assert.equal(supportSubject("MISSING_ITEM", ""), "Missing item");
  assert.equal(supportSubject("DELIVERY", "  Runner went to the wrong hostel "), "Delivery problem: Runner went to the wrong hostel");
  assert.equal(supportSubject("NOT_A_CATEGORY", "anything"), null);
  assert.equal(supportSubject("OTHER", "x".repeat(200)), null);
});

test("every support status has a student-facing label", () => {
  for (const status of ["OPEN", "IN_PROGRESS", "ESCALATED", "RESOLVED", "CLOSED"]) assert.doesNotMatch(supportStatusLabel(status), /_/);
});
