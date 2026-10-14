/**
 * How often a payment-status page re-checks with the server. Each check queries OPay, so polling
 * backs off and stops after five minutes; the student can still tap "Check again".
 * Returns the delay before the next check, or null to stop.
 */
export const PAYMENT_POLL_STOP_AFTER_MS = 5 * 60_000;

export function nextPaymentPollDelay(elapsedMs: number) {
  if (elapsedMs >= PAYMENT_POLL_STOP_AFTER_MS) return null;
  if (elapsedMs < 30_000) return 5_000;
  if (elapsedMs < 2 * 60_000) return 10_000;
  return 30_000;
}
