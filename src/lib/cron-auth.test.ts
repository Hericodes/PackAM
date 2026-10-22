import assert from "node:assert/strict";
import { test } from "node:test";
import { cronSecretConfigured, isAuthorizedCronRequest } from "./cron-auth";

const SECRET = "a-long-cron-secret-for-tests-123";

test("only the exact CRON_SECRET as a bearer token is accepted", () => {
  assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(isAuthorizedCronRequest(`bearer ${SECRET}`, SECRET), true, "scheme is case-insensitive");
  for (const header of [null, undefined, "", SECRET, `Basic ${SECRET}`, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, "Bearer wrong-secret-value-of-len"]) {
    assert.equal(isAuthorizedCronRequest(header, SECRET), false, String(header));
  }
});

test("a missing or too-short secret refuses every request", () => {
  assert.equal(cronSecretConfigured(undefined), false);
  assert.equal(cronSecretConfigured("short"), false);
  assert.equal(cronSecretConfigured(SECRET), true);
  assert.equal(isAuthorizedCronRequest("Bearer short", "short"), false);
  assert.equal(isAuthorizedCronRequest("Bearer ", undefined), false);
});
