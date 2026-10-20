/**
 * Status wording for operations screens (admin and runner). Plain and precise: staff act on these,
 * so there is no humour here. Student-facing wording lives in student-copy.ts.
 */

export type StatusTone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";

type StatusDisplay = { label: string; tone: StatusTone };

export const ORDER_STATUS_DISPLAY: Record<string, StatusDisplay> = {
  PENDING_PAYMENT: { label: "Pending payment", tone: "neutral" },
  PAYMENT_CONFIRMED: { label: "Payment confirmed", tone: "info" },
  FINDING_RUNNER: { label: "Finding runner", tone: "warning" },
  RUNNER_ASSIGNED: { label: "Runner assigned", tone: "progress" },
  SOURCING_PRODUCT: { label: "Sourcing", tone: "progress" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "progress" },
  DELIVERED: { label: "Delivered", tone: "success" },
  REFUND_PROCESSING: { label: "Refund processing", tone: "warning" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const PRINT_STATUS_DISPLAY: Record<string, StatusDisplay> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  READY_FOR_PAYMENT: { label: "Awaiting payment", tone: "neutral" },
  PAYMENT_CONFIRMED: { label: "Payment confirmed", tone: "info" },
  FINDING_RUNNER: { label: "Finding runner", tone: "warning" },
  RUNNER_ASSIGNED: { label: "Runner assigned", tone: "progress" },
  DOCUMENT_RECEIVED: { label: "Document received", tone: "progress" },
  PRINTING: { label: "Printing", tone: "progress" },
  PRINTED: { label: "Printed", tone: "progress" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "progress" },
  DELIVERED: { label: "Delivered", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  DOCUMENT_UNREADABLE: { label: "Document unreadable", tone: "danger" },
  PRINT_FAILED: { label: "Print failed", tone: "danger" },
  REFUND_PROCESSING: { label: "Refund processing", tone: "warning" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },
};

export const PAYMENT_STATUS_DISPLAY: Record<string, StatusDisplay> = {
  PENDING: { label: "Payment pending", tone: "neutral" },
  SUCCESS: { label: "Paid", tone: "success" },
  RECONCILIATION_REQUIRED: { label: "Needs reconciliation", tone: "danger" },
  FAILED: { label: "Payment failed", tone: "danger" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

function fallback(status: string): StatusDisplay {
  const words = status.replaceAll("_", " ").toLowerCase();
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: "neutral" };
}

export const orderStatusDisplay = (status: string) => ORDER_STATUS_DISPLAY[status] ?? fallback(status);
export const printStatusDisplay = (status: string) => PRINT_STATUS_DISPLAY[status] ?? fallback(status);
export const paymentStatusDisplay = (status: string | null | undefined) => status ? PAYMENT_STATUS_DISPLAY[status] ?? fallback(status) : { label: "No payment record", tone: "danger" as const };

/** What the runner does next on a marketplace mission. Describes the existing flow; it grants nothing. */
export function runnerOrderNextStep(orderStatus: string, assignmentStatus: string) {
  if (assignmentStatus === "OFFERED") return "Review the items and delivery spot, then accept if you can take it.";
  switch (orderStatus) {
    case "RUNNER_ASSIGNED": return "Buy the items: record each one as sourced or unavailable.";
    case "SOURCING_PRODUCT": return "Finish sourcing, then start the delivery.";
    case "OUT_FOR_DELIVERY": return "Deliver to the student, then mark it delivered.";
    default: return null;
  }
}

/** What the runner does next on a print mission. */
export function runnerPrintNextStep(printStatus: string, assignmentStatus: string) {
  if (assignmentStatus === "OFFERED") return "Check the job details, then accept if you can print it.";
  switch (printStatus) {
    case "RUNNER_ASSIGNED": return "Download the document and confirm you have it.";
    case "DOCUMENT_RECEIVED": return "Start printing.";
    case "PRINTING": return "Finish printing and mark it printed.";
    case "PRINTED": return "Start the delivery.";
    case "OUT_FOR_DELIVERY": return "Deliver to the student, then mark it delivered.";
    default: return null;
  }
}
