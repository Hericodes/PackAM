/**
 * What a student may do with a marketplace checkout whose payment did not go through, and the rules
 * for cancelling it. Marketplace orders are only created once OPay verifies a payment, so "Cancel
 * Order" here cancels the unpaid checkout: it never touches a paid order and never promises a refund.
 *
 * Rules:
 * - A PENDING attempt is reconciled with OPay's signed status query first. Only a provider-verified
 *   failure (FAILED/CLOSED/EXPIRED) makes it cancellable; an uncertain attempt is never failed here.
 * - A successful, refunded or under-review attempt is never cancelled through this path.
 * - Cancelling is recorded once; repeated requests return the first result.
 *
 * Dependencies are injected so the decision logic is testable without a database or network.
 */

export type CheckoutPaymentStatus = "PENDING" | "SUCCESS" | "RECONCILIATION_REQUIRED" | "FAILED" | "REFUNDED";

export type CheckoutAttemptView = {
  status: CheckoutPaymentStatus;
  orderId: string | null;
  /** The student already cancelled this unpaid checkout. */
  cancelled: boolean;
};

/** Which actions the payment-result page offers. The server re-checks everything on submit. */
export function checkoutPaymentActions(attempt: CheckoutAttemptView) {
  if (attempt.cancelled || attempt.orderId) return { canRetry: false, canCancel: false };
  if (attempt.status === "FAILED") return { canRetry: true, canCancel: true };
  // Offered, but the server cancels only after OPay confirms the payment did not complete.
  if (attempt.status === "PENDING") return { canRetry: false, canCancel: true };
  return { canRetry: false, canCancel: false };
}

export type CancelFailedResult = "CANCELLED" | "ALREADY_CANCELLED" | "NOT_FAILED" | "SUPERSEDED";

export type CancellationDeps = {
  /** Loads the attempt only if it belongs to the signed-in student and is a marketplace checkout. */
  findAttempt: () => Promise<CheckoutAttemptView | null>;
  /** Runs the trusted OPay status check, which may complete or fail the attempt. Must not throw for provider trouble. */
  reconcile: () => Promise<void>;
  /** Atomically cancels a FAILED, unclaimed attempt exactly once. */
  cancelFailed: () => Promise<CancelFailedResult>;
};

export type CancellationResult =
  | { kind: "CANCELLED"; alreadyCancelled: boolean }
  | { kind: "PAID"; orderId: string | null }
  | { kind: "STILL_PENDING" }
  | { kind: "UNDER_REVIEW" }
  | { kind: "SUPERSEDED" }
  | { kind: "NOT_FOUND" };

function settledOutcome(attempt: CheckoutAttemptView): CancellationResult | null {
  if (attempt.cancelled) return { kind: "CANCELLED", alreadyCancelled: true };
  if (attempt.orderId || attempt.status === "SUCCESS" || attempt.status === "REFUNDED") return { kind: "PAID", orderId: attempt.orderId };
  if (attempt.status === "RECONCILIATION_REQUIRED") return { kind: "UNDER_REVIEW" };
  if (attempt.status === "PENDING") return { kind: "STILL_PENDING" };
  return null;
}

export async function cancelUnpaidCheckout(deps: CancellationDeps): Promise<CancellationResult> {
  let attempt = await deps.findAttempt();
  if (!attempt) return { kind: "NOT_FOUND" };

  if (attempt.status === "PENDING" && !attempt.cancelled) {
    await deps.reconcile();
    attempt = await deps.findAttempt();
    if (!attempt) return { kind: "NOT_FOUND" };
  }

  const settled = settledOutcome(attempt);
  if (settled) return settled;

  const result = await deps.cancelFailed();
  if (result === "CANCELLED") return { kind: "CANCELLED", alreadyCancelled: false };
  if (result === "ALREADY_CANCELLED") return { kind: "CANCELLED", alreadyCancelled: true };
  if (result === "SUPERSEDED") return { kind: "SUPERSEDED" };

  // The attempt changed underneath us (e.g. a late provider success). Report what it is now.
  const latest = await deps.findAttempt();
  return (latest && settledOutcome(latest)) ?? { kind: "UNDER_REVIEW" };
}

/** HTTP mapping for the cancel route. Copy never claims money was refunded. */
export function cancellationResponse(result: CancellationResult): { status: number; body: Record<string, unknown> } {
  switch (result.kind) {
    case "CANCELLED":
      return { status: 200, body: { status: "CANCELLED", alreadyCancelled: result.alreadyCancelled } };
    case "PAID":
      return { status: 409, body: { status: "SUCCESS", orderId: result.orderId, error: "This payment went through, so your order can’t be cancelled as unpaid. You can track it in My orders." } };
    case "STILL_PENDING":
      return { status: 409, body: { status: "PENDING", error: "Payment is still being confirmed, so this order can’t be cancelled yet. OPay closes unfinished payments within about 30 minutes — please check again then." } };
    case "UNDER_REVIEW":
      return { status: 409, body: { status: "RECONCILIATION_REQUIRED", error: "Our team is checking this payment, so it can’t be cancelled right now. Please don’t pay again — we’ll update you." } };
    case "SUPERSEDED":
      return { status: 409, body: { status: "SUPERSEDED", error: "You’ve already started a newer payment for this cart, so this one can’t be cancelled. Check My orders or your cart." } };
    case "NOT_FOUND":
      return { status: 404, body: { error: "Payment attempt not found." } };
  }
}
