import assert from "node:assert/strict";
import { test } from "node:test";
import { runnerAdminActions, runnerDashboardStatus } from "./runner-access";

test("a runner account without a profile is reported as set-up pending, not an error", () => {
  assert.deepEqual(runnerDashboardStatus(null), { isAvailable: false, isVerified: false, profileMissing: true });
});

test("a runner with a profile reports its real availability and verification", () => {
  assert.deepEqual(runnerDashboardStatus({ isAvailable: true, isVerified: true }), { isAvailable: true, isVerified: true, profileMissing: false });
  assert.deepEqual(runnerDashboardStatus({ isAvailable: false, isVerified: false }), { isAvailable: false, isVerified: false, profileMissing: false });
});

test("operations can set up and verify a profile-less runner, verify an unverified one, and un-verify a verified one", () => {
  assert.deepEqual(runnerAdminActions({ role: "RUNNER", status: "ACTIVE", profile: null }), { setupNeeded: true, canVerify: true, canUnverify: false });
  assert.deepEqual(runnerAdminActions({ role: "RUNNER", status: "ACTIVE", profile: { isAvailable: false, isVerified: false } }), { setupNeeded: false, canVerify: true, canUnverify: false });
  assert.deepEqual(runnerAdminActions({ role: "RUNNER", status: "ACTIVE", profile: { isAvailable: true, isVerified: true } }), { setupNeeded: false, canVerify: false, canUnverify: true });
});

test("suspended accounts and non-runners get no verification actions", () => {
  assert.deepEqual(runnerAdminActions({ role: "RUNNER", status: "SUSPENDED", profile: null }), { setupNeeded: true, canVerify: false, canUnverify: false });
  for (const role of ["STUDENT", "ADMIN"]) {
    assert.deepEqual(runnerAdminActions({ role, status: "ACTIVE", profile: null }), { setupNeeded: false, canVerify: false, canUnverify: false }, role);
  }
});
