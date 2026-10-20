/**
 * Cancelling a print job whose payment did not complete. Unlike marketplace orders, a print job exists
 * before payment (DRAFT / READY_FOR_PAYMENT), so cancelling moves the job itself to CANCELLED.
 *
 * Rules:
 * - Only an unpaid job (DRAFT or READY_FOR_PAYMENT) whose attempts are all provider-verified FAILED can be cancelled.
 * - A PENDING attempt is reconciled with OPay's signed status query first; an uncertain attempt is never
 *   failed here, and a confirmed success means the job is paid and is not cancelled through this path.
 * - Attempts under review (RECONCILIATION_REQUIRED) block cancellation; operations decides.
 * - Cancelling is idempotent and never promises a refund.
 *
 * Dependencies are injected so the decision logic is testable without a database or network.
 */

export type PrintPaymentStatus = "PENDING" | "SUCCESS" | "RECONCILIATION_REQUIRED" | "FAILED" | "REFUNDED";

export type PrintJobPaymentView = {
  jobStatus: string;
  /** Every payment attempt for this job, any order. */
  payments: PrintPaymentStatus[];
};

const UNPAID_JOB_STATUSES = ["DRAFT", "READY_FOR_PAYMENT"];

/** Which actions the print payment page offers. The server re-checks everything on submit. */
export function printPaymentActions(view: PrintJobPaymentView) {
  const none = { canRetry: false, canCancel: false };
  if (!UNPAID_JOB_STATUSES.includes(view.jobStatus)) return none;
  if (view.payments.some((status) => status === "SUCCESS" || status === "REFUNDED" || status === "RECONCILIATION_REQUIRED")) return none;
  // Offered, but the server cancels only after OPay confirms the pending payment did not complete.
  if (view.payments.includes("PENDING")) return { canRetry: false, canCancel: true };
  return { canRetry: view.payments.length > 0, canCancel: true };
}

export type PrintCancelWriteResult = "CANCELLED" | "ALREADY_CANCELLED" | "NOT_CANCELLABLE";

export type PrintCancellationDeps = {
  /** Loads the job only if the actor may cancel it (its owner, or an admin). */
  findJob: () => Promise<PrintJobPaymentView | null>;
  /** Runs the trusted OPay status check on each PENDING attempt. Must not throw for provider trouble. */
  reconcilePending: () => Promise<void>;
  /** Atomically moves an unpaid job with no open or successful attempt to CANCELLED, once. */
  cancel: () => Promise<PrintCancelWriteResult>;
};

export type PrintCancellationResult =
  | { kind: "CANCELLED"; alreadyCancelled: boolean }
  | { kind: "PAID" }
  | { kind: "STILL_PENDING" }
  | { kind: "UNDER_REVIEW" }
  | { kind: "NOT_FOUND" };

function settledOutcome(view: PrintJobPaymentView): PrintCancellationResult | null {
  if (view.jobStatus === "CANCELLED") return { kind: "CANCELLED", alreadyCancelled: true };
  if (!UNPAID_JOB_STATUSES.includes(view.jobStatus) || view.payments.some((status) => status === "SUCCESS" || status === "REFUNDED")) return { kind: "PAID" };
  if (view.payments.includes("RECONCILIATION_REQUIRED")) return { kind: "UNDER_REVIEW" };
  if (view.payments.includes("PENDING")) return { kind: "STILL_PENDING" };
  return null;
}

export async function cancelUnpaidPrintJob(deps: PrintCancellationDeps): Promise<PrintCancellationResult> {
  let view = await deps.findJob();
  if (!view) return { kind: "NOT_FOUND" };

  if (UNPAID_JOB_STATUSES.includes(view.jobStatus) && view.payments.includes("PENDING")) {
    await deps.reconcilePending();
    view = await deps.findJob();
    if (!view) return { kind: "NOT_FOUND" };
  }

  const settled = settledOutcome(view);
  if (settled) return settled;

  const result = await deps.cancel();
  if (result === "CANCELLED") return { kind: "CANCELLED", alreadyCancelled: false };
  if (result === "ALREADY_CANCELLED") return { kind: "CANCELLED", alreadyCancelled: true };

  // The job or a payment changed underneath us (e.g. a late provider success). Report what it is now.
  const latest = await deps.findJob();
  return (latest && settledOutcome(latest)) ?? { kind: "UNDER_REVIEW" };
}

/** HTTP mapping for the cancel routes. Copy never claims money was refunded. */
export function printCancellationResponse(result: PrintCancellationResult): { status: number; body: Record<string, unknown> } {
  switch (result.kind) {
    case "CANCELLED":
      return { status: 200, body: { status: "CANCELLED", alreadyCancelled: result.alreadyCancelled } };
    case "PAID":
      return { status: 409, body: { status: "SUCCESS", error: "This print payment went through, so the job can’t be cancelled as unpaid. You can track it from Printing." } };
    case "STILL_PENDING":
      return { status: 409, body: { status: "PENDING", error: "Payment is still being confirmed, so this print job can’t be cancelled yet. OPay closes unfinished payments within about 30 minutes — please check again then." } };
    case "UNDER_REVIEW":
      return { status: 409, body: { status: "RECONCILIATION_REQUIRED", error: "Our team is checking this payment, so the print job can’t be cancelled right now. Please don’t pay again — we’ll update you." } };
    case "NOT_FOUND":
      return { status: 404, body: { error: "Print job not found." } };
  }
}
