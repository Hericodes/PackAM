import assert from "node:assert/strict";
import { test } from "node:test";
import { signUnsubscribeToken, unsubscribeSecretConfigured, verifyUnsubscribeToken } from "./unsubscribe";

const secret = "a-long-test-secret-of-32-characters!";
const userId = "cmh1abc2def3ghi4jkl5";

test("a token names one student and one kind, and verifies with the same key", () => {
  const token = signUnsubscribeToken(secret, userId, "morning");
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "URL-safe");
  assert.deepEqual(verifyUnsubscribeToken(secret, token), { userId, scope: "morning" });
  assert.equal(signUnsubscribeToken(secret, userId, "morning"), token, "stable: an old email's link keeps working");
});

test("tampered, swapped or foreign tokens are refused", () => {
  const morning = signUnsubscribeToken(secret, userId, "morning");
  const [, sig] = morning.split(".");
  const otherStudent = `${Buffer.from(`cmh9zzz9zzz9zzz9zzz9:morning`).toString("base64url")}.${sig}`;
  const otherKind = `${Buffer.from(`${userId}:announcements`).toString("base64url")}.${sig}`;
  for (const token of [otherStudent, otherKind, `${morning}x`, morning.replace(".", ""), "", "a.b.c", 42, null]) {
    assert.equal(verifyUnsubscribeToken(secret, token), null, String(token));
  }
  assert.equal(verifyUnsubscribeToken("another-secret-entirely-1234", morning), null, "signed with another key");
  assert.equal(verifyUnsubscribeToken(undefined, morning), null, "no key, no unsubscribe");
});

test("a short or missing secret can't sign", () => {
  assert.equal(unsubscribeSecretConfigured("short"), false);
  assert.equal(unsubscribeSecretConfigured(undefined), false);
  assert.throws(() => signUnsubscribeToken("short", userId, "morning"));
});
