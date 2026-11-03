/**
 * Manual bank-transfer payments (provider MANUAL). Pure helpers, shared by the routes, the pages and the tests.
 *
 * How it works: the student pays PackAM's own bank account, writes a short code in the transfer remark and taps
 * "I've made the payment". That tap is only a claim; it never marks anything paid. An admin checks the credit in
 * the bank app and confirms it by hand, and only that confirmation creates the order (through the same
 * completeVerifiedPayment as OPay and Paystack). A wrong amount is refused, so a mistyped confirm can't create an
 * order for the wrong money.
 */

/** No 0/O/1/I/L: a code read aloud or typed from a screenshot can't be misread. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const TRANSFER_CODE_LENGTH = 5;
export const TRANSFER_CODE_PREFIX = "PK-";

/** `random` returns an integer in [0, max). Injected so tests are deterministic. */
export function generateTransferCode(random: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < TRANSFER_CODE_LENGTH; i += 1) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return `${TRANSFER_CODE_PREFIX}${code}`;
}

/**
 * How long a student has to send the money once they get the account number. The page shows this deadline; an
 * attempt nobody has said they paid is closed a few minutes after it (the grace covers a transfer sent at minute 29),
 * so a stale checkout never sits open holding its price. A student who HAS said they paid is never closed
 * automatically: their money may already be in the account, so only an admin confirms or rejects it, and admins are
 * reminded if it waits longer than this.
 */
export const MANUAL_TRANSFER_WINDOW_MS = 30 * 60_000;
export const MANUAL_TRANSFER_GRACE_MS = 5 * 60_000;

/** The deadline the student sees. */
export function manualTransferDeadline(createdAt: Date) {
  return new Date(createdAt.getTime() + MANUAL_TRANSFER_WINDOW_MS);
}

/** True once an unclaimed attempt is past its deadline and the grace. A claimed attempt never expires. */
export function isManualTransferExpired(attempt: { createdAt: Date; transferClaimedAt: Date | null }, now: Date) {
  return attempt.transferClaimedAt === null && now.getTime() >= attempt.createdAt.getTime() + MANUAL_TRANSFER_WINDOW_MS + MANUAL_TRANSFER_GRACE_MS;
}

/** A claim still waiting for an admin this long after it was made gets a reminder to every admin. */
export const MANUAL_CLAIM_REMINDER_AFTER_MS = MANUAL_TRANSFER_WINDOW_MS;

export type ManualTransferAccount = { bankName: string; accountNumber: string; accountName: string };

/**
 * The account students pay into, from server-only env vars. Null when anything is missing, so checkout refuses to
 * show a half-configured account instead of sending students' money to a blank one.
 */
export function manualTransferAccount(env: Record<string, string | undefined>): ManualTransferAccount | null {
  const bankName = env.MANUAL_TRANSFER_BANK_NAME?.trim();
  const accountNumber = env.MANUAL_TRANSFER_ACCOUNT_NUMBER?.replace(/\s+/g, "");
  const accountName = env.MANUAL_TRANSFER_ACCOUNT_NAME?.trim();
  if (!bankName || !accountName || !accountNumber || !/^\d{10}$/.test(accountNumber)) return null;
  return { bankName, accountNumber, accountName };
}

/** What the student's payment page needs for a pending manual transfer. */
export type ManualTransferView = ManualTransferAccount & {
  code: string;
  amount: number;
  claimed: boolean;
  /** ISO time to send the money by (see MANUAL_TRANSFER_WINDOW_MS). */
  payBy: string;
};

export function manualTransferView(
  account: ManualTransferAccount,
  attempt: { transferCode: string | null; amount: number; transferClaimedAt: Date | null; createdAt: Date },
): ManualTransferView | null {
  if (!attempt.transferCode) return null;
  return { ...account, code: attempt.transferCode, amount: attempt.amount, claimed: attempt.transferClaimedAt !== null, payBy: manualTransferDeadline(attempt.createdAt).toISOString() };
}

export type ConfirmAmountCheck = { ok: true; extra: number } | { ok: false; error: string };

/**
 * The admin must type the amount the bank shows. Confirming only goes ahead when at least the order's amount was
 * received: an underpayment must never release goods. An overpayment still confirms (the order is for its own
 * amount) and reports the extra so it can be refunded or credited by hand.
 */
export function checkReceivedAmount(received: unknown, expected: number): ConfirmAmountCheck {
  if (typeof received !== "number" || !Number.isSafeInteger(received) || received <= 0) {
    return { ok: false, error: "Enter the amount you received in naira, as a whole number." };
  }
  if (received < expected) {
    return { ok: false, error: `Only ₦${received.toLocaleString()} was received but this order is ₦${expected.toLocaleString()}. Don’t confirm it. Ask the student to send the balance, or reject the payment.` };
  }
  return { ok: true, extra: received - expected };
}

export function transferResultPath(reference: string) {
  return `/checkout/payment-result?reference=${encodeURIComponent(reference)}`;
}
