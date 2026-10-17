/**
 * Typed payment errors. Callers decide between "route to manual review" and "retry later" by error
 * class, never by matching words in a message. Messages must stay free of secrets and customer data.
 */

/** A signed provider record disagrees with PackAM's payment attempt (reference, order, amount, currency or transaction). */
export class OpayVerificationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpayVerificationMismatchError";
  }
}

/** OPay credentials or environment are missing or invalid. Operational, not a payment problem. */
export class OpayConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpayConfigurationError";
  }
}

/** OPay could not be reached, timed out, or returned an unusable response. Safe to retry. */
export class OpayProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpayProviderUnavailableError";
  }
}

/** OPay answered but declined the request with a non-success code (e.g. an unknown reference). */
export class OpayProviderRejectedError extends Error {
  constructor(readonly code: string) {
    super(`OPay rejected the request (${code}).`);
    this.name = "OpayProviderRejectedError";
  }
}

/**
 * A provider-verified success could not be finalized because PackAM's own records disagree with it
 * (amount, snapshot, or a different transaction already recorded). Money may be captured with no order.
 */
export class PaymentFinalizationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentFinalizationMismatchError";
  }
}

export type PaymentErrorClass =
  /** Genuine disagreement after verification: flag the attempt for operations review. */
  | "mismatch"
  /** The lifecycle already moved the attempt to review and alerted operations. */
  | "under_review"
  /** Configuration, network, provider or database trouble: report retryable, never flag. */
  | "transient";

export function classifyPaymentError(error: unknown): PaymentErrorClass {
  if (error instanceof OpayVerificationMismatchError || error instanceof PaymentFinalizationMismatchError) return "mismatch";
  // Defined in the server-only print lifecycle, so it is recognised by name here.
  if (error instanceof Error && error.name === "PrintPaymentNeedsReviewError") return "under_review";
  return "transient";
}

/** Secret-free fields for logs: the error class and, for provider rejections, OPay's response code. */
export function describePaymentError(error: unknown) {
  if (error instanceof OpayProviderRejectedError) return { errorName: error.name, providerCode: error.code };
  return { errorName: error instanceof Error ? error.name : "UnknownError" };
}
