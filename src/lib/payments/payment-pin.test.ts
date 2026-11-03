import assert from "node:assert/strict";
import test from "node:test";
import { PAYMENT_PIN_LOCK_MS, PAYMENT_PIN_MAX_FAILURES, afterWrongPin, checkNewPin, isPinLocked, isPinShaped, lockedMessage, wrongPinMessage } from "./payment-pin";

test("a new PIN is 6 digits and not an obvious one", () => {
  for (const good of ["482915", "730264", "190837", "551903"]) assert.equal(checkNewPin(good).ok, true, good);
  for (const bad of ["12345", "1234567", "12a456", " 482915", "", null, 482915]) assert.equal(checkNewPin(bad).ok, false, String(bad));
  for (const guessable of ["000000", "999999", "123456", "654321", "345678", "121212", "909090", "123123", "456456"]) {
    const result = checkNewPin(guessable);
    assert.equal(result.ok, false, guessable);
    assert.match(result.ok ? "" : result.error, /too easy to guess/);
  }
});

test("only a 6-digit string is even compared with the hash", () => {
  assert.equal(isPinShaped("482915"), true);
  for (const bad of ["48291", "4829150", "48291x", 482915, undefined, null]) assert.equal(isPinShaped(bad), false, String(bad));
});

test("five wrong tries in a row lock the PIN for 15 minutes, then counting starts again", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  let state = { failedCount: 0, lockedUntil: null as Date | null };
  for (let i = 1; i < PAYMENT_PIN_MAX_FAILURES; i += 1) {
    const next = afterWrongPin(state, now);
    assert.deepEqual({ count: next.failedCount, locked: next.lockedNow }, { count: i, locked: false });
    state = next;
  }
  const locked = afterWrongPin(state, now);
  assert.equal(locked.lockedNow, true);
  assert.equal(locked.failedCount, 0);
  assert.equal(locked.lockedUntil!.getTime(), now.getTime() + PAYMENT_PIN_LOCK_MS);
  assert.equal(isPinLocked(locked, new Date(now.getTime() + PAYMENT_PIN_LOCK_MS - 1)), true);
  assert.equal(isPinLocked(locked, new Date(now.getTime() + PAYMENT_PIN_LOCK_MS)), false);
  const afterLock = afterWrongPin(locked, new Date(now.getTime() + PAYMENT_PIN_LOCK_MS + 1));
  assert.deepEqual({ count: afterLock.failedCount, lockedUntil: afterLock.lockedUntil, lockedNow: afterLock.lockedNow }, { count: 1, lockedUntil: null, lockedNow: false });
});

test("the messages say how many tries are left and how long the lock lasts", () => {
  assert.equal(wrongPinMessage(1), "Wrong PIN. 4 tries left before it locks for 15 minutes.");
  assert.equal(wrongPinMessage(4), "Wrong PIN. 1 try left before it locks for 15 minutes.");
  const now = new Date("2026-11-03T12:00:00Z");
  assert.match(lockedMessage(new Date(now.getTime() + 14.2 * 60_000), now), /15 minutes/);
  assert.match(lockedMessage(new Date(now.getTime() + 10_000), now), /1 minute,/);
});
