/**
 * OPay verification shared by the webhook and the student's status poll.
 *
 * Rules:
 * - The signed Cashier status query is the only authority for a payment's final state and amount.
 * - A callback is a signed trigger to run that query; its own amount is logged, never trusted.
 * - Only a verified mismatch is routed to manual review. Configuration, network, provider and
 *   database trouble is reported as retryable so the payment is checked again later.
 *
 * Dependencies are injected so the decision logic is testable without a database or network.
 */
import { classifyPaymentError, describePaymentError, OpayVerificationMismatchError } from "./payment-errors";
import { describeCallbackAmount, mapProviderStatus, verifyOpayTransaction, type OpayTransaction } from "./providers/opay-money";

export type PaymentAttemptForVerification = {
  reference: string;
  amount: number;
  currency: string;
  providerCheckoutReference: string | null;
};

export type CompletionResult = { orderId: string | null; printJobId?: string | null; alreadyProcessed: boolean };

export type PaymentLogger = {
  info: (event: string, fields: Record<string, unknown>) => void;
  warn: (event: string, fields: Record<string, unknown>) => void;
  error: (event: string, fields: Record<string, unknown>) => void;
};

export type VerificationDeps = {
  queryStatus: (reference: string) => Promise<OpayTransaction>;
  /** Finalizes a provider-verified success. Chooses the order or print-job root and is idempotent. */
  complete: (verified: { transactionReference: string; providerReference: string; amount: number; currency: string }) => Promise<CompletionResult>;
  /** Marks a still-PENDING attempt FAILED; a no-op for anything else. */
  fail: (reference: string) => Promise<boolean>;
  /** Moves the attempt to RECONCILIATION_REQUIRED and alerts operations. */
  markReview: (reference: string, reason: string) => Promise<boolean>;
  log: PaymentLogger;
};

export type VerificationOutcome =
  | { status: "SUCCESS"; orderId: string | null; printJobId: string | null }
  | { status: "FAILED" }
  | { status: "PENDING" };

/** References are PackAM-generated, not secret; logs still carry only the tail for correlation. */
export const referenceTail = (reference: string) => reference.slice(-8);

export const consolePaymentLogger: PaymentLogger = {
  info: (event, fields) => console.info(JSON.stringify({ event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
};

/**
 * Queries OPay, verifies the signed record against the attempt, and applies the verified state.
 * `callbackTransactionId` (webhook only) must match the provider transaction when OPay reports success.
 */
export async function verifyAndApplyOpayPayment(
  attempt: PaymentAttemptForVerification,
  deps: VerificationDeps,
  options: { callbackTransactionId?: string } = {},
): Promise<VerificationOutcome> {
  const transaction = await deps.queryStatus(attempt.reference);
  const verified = verifyOpayTransaction(transaction, {
    reference: attempt.reference,
    amount: attempt.amount,
    currency: attempt.currency,
    providerCheckoutReference: attempt.providerCheckoutReference,
  });
  deps.log.info("opay_status_verified", { refTail: referenceTail(attempt.reference), providerStatus: transaction.status ?? null, verifiedStatus: verified.status });

  if (verified.status === "SUCCESS") {
    if (options.callbackTransactionId !== undefined && verified.providerReference !== options.callbackTransactionId) {
      throw new OpayVerificationMismatchError("OPay callback transaction identifier does not match the queried payment.");
    }
    const result = await deps.complete({
      transactionReference: attempt.reference,
      providerReference: verified.providerReference!,
      amount: attempt.amount,
      currency: attempt.currency,
    });
    return { status: "SUCCESS", orderId: result.orderId, printJobId: result.printJobId ?? null };
  }
  if (verified.status === "FAILED") {
    await deps.fail(attempt.reference);
    return { status: "FAILED" };
  }
  return { status: "PENDING" };
}

type HandlerResponse = { status: number; body?: Record<string, unknown> };

/**
 * Shared failure handling: a verified mismatch is flagged once (and acknowledged), everything else is
 * retryable. Returns whether the attempt is now under review.
 */
async function routeVerificationError(error: unknown, reference: string, reason: string, deps: VerificationDeps) {
  const kind = classifyPaymentError(error);
  const fields = { refTail: referenceTail(reference), classification: kind, ...describePaymentError(error) };
  if (kind === "transient") {
    deps.log.warn("opay_verification_retryable", fields);
    return { underReview: false, flagFailed: false };
  }
  if (kind === "under_review") {
    deps.log.warn("opay_payment_under_review", fields);
    return { underReview: true, flagFailed: false };
  }
  deps.log.error("opay_verification_mismatch", fields);
  try {
    await deps.markReview(reference, reason);
    return { underReview: true, flagFailed: false };
  } catch (reviewError) {
    deps.log.error("opay_review_flag_failed", { refTail: referenceTail(reference), ...describePaymentError(reviewError) });
    return { underReview: false, flagFailed: true };
  }
}

// ---------------------------------------------------------------- webhook

type CallbackPayload = {
  amount: string;
  currency: string;
  reference: string;
  country: string;
  refunded: boolean;
  status: string;
  timestamp: string;
  token?: string;
  transactionId: string;
};

export type OpayCallback = { payload: CallbackPayload; sha512: string; type: string };

export function isOpayCallback(value: unknown): value is OpayCallback {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<OpayCallback>;
  const payload = body.payload;
  return !!payload && typeof payload === "object" &&
    typeof payload.amount === "string" && typeof payload.currency === "string" &&
    typeof payload.reference === "string" && typeof payload.country === "string" &&
    typeof payload.refunded === "boolean" && typeof payload.status === "string" &&
    typeof payload.timestamp === "string" && typeof payload.transactionId === "string" &&
    typeof body.sha512 === "string" && typeof body.type === "string";
}

export type CallbackDeps = VerificationDeps & {
  verifySignature: (callback: OpayCallback) => boolean;
  findAttempt: (reference: string) => Promise<PaymentAttemptForVerification | null>;
};

/**
 * OPay retries any non-2xx callback for up to 72 hours, so 503 means "try again later" and 200 means
 * "handled": applied, safely ignored, or routed to manual review.
 */
export async function handleOpayCallback(body: unknown, deps: CallbackDeps): Promise<HandlerResponse> {
  if (!isOpayCallback(body) || body.type !== "transaction-status" || body.payload.country !== "NG" || body.payload.refunded) {
    return { status: 400, body: { error: "Invalid callback." } };
  }
  const reference = body.payload.reference;

  let signatureValid: boolean;
  try {
    signatureValid = deps.verifySignature(body);
  } catch (error) {
    // Usually missing OPay configuration. Nothing is verified yet, so nothing may be flagged.
    deps.log.error("opay_callback_signature_unavailable", { refTail: referenceTail(reference), ...describePaymentError(error) });
    return { status: 503, body: { error: "Callback could not be verified yet." } };
  }
  if (!signatureValid) {
    deps.log.warn("opay_callback_signature_rejected", { refTail: referenceTail(reference) });
    return { status: 400, body: { error: "Invalid callback signature." } };
  }

  let attempt: PaymentAttemptForVerification | null;
  try {
    attempt = await deps.findAttempt(reference);
  } catch (error) {
    deps.log.warn("opay_callback_lookup_failed", { refTail: referenceTail(reference), ...describePaymentError(error) });
    return { status: 503, body: { error: "Callback could not be verified yet." } };
  }
  if (!attempt) {
    deps.log.error("opay_callback_unknown_reference", { refTail: referenceTail(reference) });
    return { status: 200 };
  }

  const callbackStatus = mapProviderStatus(body.payload.status);
  deps.log.info("opay_callback_received", {
    refTail: referenceTail(reference),
    callbackStatus: body.payload.status,
    callbackAmount: body.payload.amount,
    callbackCurrency: body.payload.currency,
    // Recorded to settle OPay's undocumented callback amount unit from real traffic.
    callbackAmountUnit: describeCallbackAmount(body.payload.amount, attempt.amount),
    expectedAmountNgn: attempt.amount,
  });
  // A pending callback carries no final state; the student's status poll or a later callback will.
  if (callbackStatus === "PENDING") return { status: 200 };

  try {
    await verifyAndApplyOpayPayment(attempt, deps, { callbackTransactionId: body.payload.transactionId });
    return { status: 200 };
  } catch (error) {
    const routed = await routeVerificationError(error, reference, "provider verification mismatch", deps);
    return routed.underReview ? { status: 200 } : { status: 503, body: { error: "Callback could not be verified yet." } };
  }
}

// ---------------------------------------------------------------- student status poll

/**
 * What one trusted status check established. Only CONFIRMED_* outcomes come from a verified, signed
 * provider record; every other outcome leaves the payment's money state exactly as it was.
 */
export type DetailedVerification =
  | { outcome: "CONFIRMED_SUCCESS"; providerStatus: string | null; orderId: string | null; printJobId: string | null }
  | { outcome: "CONFIRMED_FAILED"; providerStatus: string | null }
  | { outcome: "PROVIDER_PENDING"; providerStatus: string | null }
  /** The status query itself failed: timeout, network, configuration, provider error or unreadable reply. */
  | { outcome: "PROVIDER_UNAVAILABLE"; errorName: string; providerCode?: string }
  /** OPay answered, but PackAM could not apply it (e.g. a database error); retryable. */
  | { outcome: "NOT_APPLIED"; providerStatus: string | null; errorName: string }
  /** The signed record disagrees with the attempt; it is flagged for review. */
  | { outcome: "MISMATCH"; errorName: string; flagged: boolean }
  /** The lifecycle already holds this payment for operations (e.g. a second print payment). */
  | { outcome: "UNDER_REVIEW"; errorName: string };

export async function verifyOpayPaymentDetailed(attempt: PaymentAttemptForVerification, deps: VerificationDeps): Promise<DetailedVerification> {
  let answered = false;
  let providerStatus: string | null = null;
  const tracked: VerificationDeps = {
    ...deps,
    queryStatus: async (reference) => {
      const transaction = await deps.queryStatus(reference);
      answered = true;
      providerStatus = typeof transaction?.status === "string" ? transaction.status.slice(0, 40) : null;
      return transaction;
    },
  };
  try {
    const outcome = await verifyAndApplyOpayPayment(attempt, tracked);
    if (outcome.status === "SUCCESS") return { outcome: "CONFIRMED_SUCCESS", providerStatus, orderId: outcome.orderId, printJobId: outcome.printJobId };
    if (outcome.status === "FAILED") return { outcome: "CONFIRMED_FAILED", providerStatus };
    return { outcome: "PROVIDER_PENDING", providerStatus };
  } catch (error) {
    const routed = await routeVerificationError(error, attempt.reference, "provider status mismatch", deps);
    const kind = classifyPaymentError(error);
    const described = describePaymentError(error);
    if (kind === "under_review") return { outcome: "UNDER_REVIEW", errorName: described.errorName };
    if (kind === "mismatch") return { outcome: "MISMATCH", errorName: described.errorName, flagged: routed.underReview };
    return answered
      ? { outcome: "NOT_APPLIED", providerStatus, errorName: described.errorName }
      : { outcome: "PROVIDER_UNAVAILABLE", ...described };
  }
}

export async function checkOpayPaymentStatus(attempt: PaymentAttemptForVerification, deps: VerificationDeps): Promise<HandlerResponse> {
  const result = await verifyOpayPaymentDetailed(attempt, deps);
  if (result.outcome === "CONFIRMED_SUCCESS") return { status: 200, body: { status: "SUCCESS", orderId: result.orderId, printJobId: result.printJobId } };
  if (result.outcome === "CONFIRMED_FAILED") return { status: 200, body: { status: "FAILED" } };
  if (result.outcome === "PROVIDER_PENDING") return { status: 200, body: { status: "PENDING" } };
  return { status: 503, body: { error: "We’re still confirming your payment. Please check again shortly." } };
}
