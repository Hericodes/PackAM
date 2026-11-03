/**
 * Admin payment PINs, the pure part: what a PIN may be and how the lockout counts. Shared by the routes, the admin
 * page and the tests (no server-only imports).
 *
 * Why: confirming a bank transfer creates an order and releases goods, and rejecting one closes a student's payment.
 * A stolen session cookie or a stolen password alone must not be enough to do either, so each admin also has their
 * own 6-digit PIN, separate from the login password, asked for on every confirm or reject.
 */

export const PAYMENT_PIN_LENGTH = 6;
/** Wrong tries in a row before the PIN is locked. */
export const PAYMENT_PIN_MAX_FAILURES = 5;
export const PAYMENT_PIN_LOCK_MS = 15 * 60_000;

export type PinCheck = { ok: true } | { ok: false; error: string };

/** The one wording for the format, in the browser and on the server. */
export const PIN_FORMAT_RULE = `Use exactly ${PAYMENT_PIN_LENGTH} digits.`;

/**
 * A new PIN: 6 digits, and not one anybody would guess first (all the same digit, a straight run up or down, or a
 * short pattern repeated, like 121212 or 123123).
 */
export function checkNewPin(pin: unknown): PinCheck {
  if (typeof pin !== "string" || !new RegExp(`^\\d{${PAYMENT_PIN_LENGTH}}$`).test(pin)) return { ok: false, error: PIN_FORMAT_RULE };
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, i) => digit - digits[i]);
  const run = steps.every((step) => step === 1) || steps.every((step) => step === -1);
  const repeats = /^(\d)\1+$/.test(pin) || /^(\d{2})\1+$/.test(pin) || /^(\d{3})\1$/.test(pin);
  if (run || repeats) return { ok: false, error: "That PIN is too easy to guess. Avoid repeated digits, runs like 123456 and patterns like 121212." };
  return { ok: true };
}

/** A PIN typed to approve an action: only its shape is checked here; the hash decides. */
export function isPinShaped(pin: unknown): pin is string {
  return typeof pin === "string" && new RegExp(`^\\d{${PAYMENT_PIN_LENGTH}}$`).test(pin);
}

export type PinLockState = { failedCount: number; lockedUntil: Date | null };

/** Still locked at `now`? */
export function isPinLocked(state: PinLockState, now: Date) {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * The row after one wrong try. A try after a lock has ended starts counting again from one. The try that reaches
 * the limit locks the PIN and resets the count.
 */
export function afterWrongPin(state: PinLockState, now: Date): PinLockState & { lockedNow: boolean } {
  const expired = state.lockedUntil !== null && state.lockedUntil.getTime() <= now.getTime();
  const failures = (expired ? 0 : state.failedCount) + 1;
  if (failures >= PAYMENT_PIN_MAX_FAILURES) return { failedCount: 0, lockedUntil: new Date(now.getTime() + PAYMENT_PIN_LOCK_MS), lockedNow: true };
  return { failedCount: failures, lockedUntil: expired ? null : state.lockedUntil, lockedNow: false };
}

/** "Wrong PIN. 3 tries left before it locks for 15 minutes." */
export function wrongPinMessage(failedCount: number) {
  const left = PAYMENT_PIN_MAX_FAILURES - failedCount;
  return `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left before it locks for ${PAYMENT_PIN_LOCK_MS / 60_000} minutes.`;
}

export function lockedMessage(lockedUntil: Date, now: Date) {
  const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000));
  return `Your payment PIN is locked after too many wrong tries. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}, or ask another admin to reset it.`;
}
