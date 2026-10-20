/**
 * Rules for the admin payment review screen. Pure, so they are unit-tested and shared by the page and
 * the API. The API re-checks everything; hiding an action here is a convenience, never the safeguard.
 *
 * Principles:
 * - Only a verified, signed OPay status record changes a payment's money state.
 * - A timeout, an error or an empty reply is not evidence of anything; the payment stays unresolved.
 * - A review case is operational bookkeeping. Closing it never says money was or wasn't received.
 */
import type { DetailedVerification } from "./opay-verification";

/** OPay cashier sessions expire after 30 minutes; an attempt still PENDING well after that is stuck. */
export const STALE_PENDING_AFTER_MS = 45 * 60_000;
/** Longer than one OPay request (15s timeout) plus finalisation, so checks for one payment never overlap. */
export const VERIFY_LOCK_MS = 45_000;
export const REVIEW_NOTE_MIN = 10;
export const REVIEW_NOTE_MAX = 1000;

export type ReviewPaymentView = {
  paymentStatus: string;
  orderId: string | null;
  printJobId: string | null;
  printJobStatus: string | null;
  hasTransactionReference: boolean;
  /** A marketplace checkout already cancelled by the student or an admin. */
  checkoutCancelled: boolean;
  caseStatus: "OPEN" | "CLOSED" | null;
};

export function isUnresolvedPayment(payment: { status: string; orderId: string | null; printJobId: string | null; createdAt: Date }, now = new Date()) {
  if (payment.status === "RECONCILIATION_REQUIRED") return true;
  // Legacy: a captured marketplace payment with no order (the database now refuses new ones).
  if (payment.status === "SUCCESS" && !payment.orderId && !payment.printJobId) return true;
  return payment.status === "PENDING" && now.getTime() - payment.createdAt.getTime() >= STALE_PENDING_AFTER_MS;
}

export function reviewActions(view: ReviewPaymentView) {
  const checkable = view.hasTransactionReference && (view.paymentStatus === "PENDING" || view.paymentStatus === "RECONCILIATION_REQUIRED");
  // Cancelling is offered only while the money state allows it; the server still reconciles first.
  const unpaidMoneyState = view.paymentStatus === "PENDING" || view.paymentStatus === "FAILED";
  let cancel: "ORDER" | "PRINT_JOB" | null = null;
  if (view.hasTransactionReference && unpaidMoneyState && !view.orderId) {
    if (view.printJobId) {
      if (view.printJobStatus === "DRAFT" || view.printJobStatus === "READY_FOR_PAYMENT") cancel = "PRINT_JOB";
    } else if (!view.checkoutCancelled) {
      cancel = "ORDER";
    }
  }
  const closed = view.caseStatus === "CLOSED";
  return { verify: checkable, cancel, close: !closed, reopen: closed, escalate: !closed };
}

export function validateReviewNote(note: unknown): { ok: true; note: string } | { ok: false; error: string } {
  if (typeof note !== "string") return { ok: false, error: "Add a resolution note." };
  const trimmed = note.trim();
  if (trimmed.length < REVIEW_NOTE_MIN) return { ok: false, error: `The note must be at least ${REVIEW_NOTE_MIN} characters, so the next admin knows what happened.` };
  if (trimmed.length > REVIEW_NOTE_MAX) return { ok: false, error: `The note must be ${REVIEW_NOTE_MAX} characters or fewer.` };
  return { ok: true, note: trimmed };
}

export type CheckOutcome = DetailedVerification["outcome"];

export const CHECK_OUTCOME_DISPLAY: Record<CheckOutcome, { label: string; tone: "success" | "danger" | "warning" | "neutral"; meaning: string }> = {
  CONFIRMED_SUCCESS: { label: "OPay confirmed paid", tone: "success", meaning: "OPay’s signed record shows the payment succeeded. The existing finalisation ran once (order/print job created or already existed)." },
  CONFIRMED_FAILED: { label: "OPay confirmed not paid", tone: "neutral", meaning: "OPay’s signed record shows the payment failed or closed. No money was captured for this attempt." },
  PROVIDER_PENDING: { label: "OPay still pending", tone: "warning", meaning: "OPay hasn’t finished this payment yet. Nothing changed. Check again later." },
  PROVIDER_UNAVAILABLE: { label: "OPay unreachable", tone: "danger", meaning: "The status check didn’t get an answer (timeout, network or provider error). This proves nothing about the payment. Nothing changed." },
  NOT_APPLIED: { label: "Answer not applied", tone: "danger", meaning: "OPay answered, but PackAM couldn’t apply it. Nothing changed. Try again." },
  MISMATCH: { label: "Record mismatch", tone: "danger", meaning: "OPay’s signed record doesn’t match this attempt (amount, currency or reference). The payment stays under review." },
  UNDER_REVIEW: { label: "Held for review", tone: "danger", meaning: "This success can’t be finalised automatically (for example a second payment for a paid print job). Resolve it manually." },
};

/** Secret-free one-line detail for the case record and audit log. */
export function describeCheck(result: DetailedVerification) {
  switch (result.outcome) {
    case "CONFIRMED_SUCCESS":
    case "CONFIRMED_FAILED":
    case "PROVIDER_PENDING":
      return `OPay status: ${result.providerStatus ?? "not given"}`;
    case "NOT_APPLIED":
      return `OPay status: ${result.providerStatus ?? "not given"} · ${result.errorName}`;
    case "PROVIDER_UNAVAILABLE":
      return result.providerCode ? `${result.errorName} · OPay code ${result.providerCode}` : result.errorName;
    case "MISMATCH":
      return `${result.errorName}${result.flagged ? " · flagged for review" : ""}`;
    case "UNDER_REVIEW":
      return result.errorName;
  }
}

export function formatUnresolvedFor(since: Date, now = new Date()) {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}
