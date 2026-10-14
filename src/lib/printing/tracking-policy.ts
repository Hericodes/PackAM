/** Student-facing view of PrintJob progress. Pure so it can be unit-tested. */

export const STUDENT_PRINT_STEPS = [
  { status: "FINDING_RUNNER", label: "Finding a runner" },
  { status: "RUNNER_ASSIGNED", label: "Runner assigned" },
  { status: "DOCUMENT_RECEIVED", label: "Document received" },
  { status: "PRINTING", label: "Printing" },
  { status: "PRINTED", label: "Printed" },
  { status: "OUT_FOR_DELIVERY", label: "On the way" },
  { status: "DELIVERED", label: "Delivered" },
] as const;

const ISSUE_MESSAGES: Record<string, { title: string; message: string }> = {
  DOCUMENT_UNREADABLE: { title: "We’re checking your document", message: "The runner couldn’t open or read your PDF. PackAM operations is reviewing it and will update you." },
  PRINT_FAILED: { title: "We hit a printing problem", message: "The runner reported a printing problem. PackAM operations is reviewing it and will update you." },
  REFUND_PROCESSING: { title: "Refund processing", message: "This print job has stopped and your refund is being processed. We’ll update you when it’s confirmed." },
  REFUNDED: { title: "Refund confirmed", message: "Your refund for this print job has been confirmed." },
  CANCELLED: { title: "Print job cancelled", message: "This print job was cancelled." },
  FAILED: { title: "Print job needs attention", message: "Something went wrong with this print job. PackAM support will reach out." },
};

const OTHER_LABELS: Record<string, string> = {
  DRAFT: "Not paid yet",
  READY_FOR_PAYMENT: "Waiting for payment",
  PAYMENT_CONFIRMED: "Payment confirmed",
  DOCUMENT_UNREADABLE: "Checking your document",
  PRINT_FAILED: "Printing problem — we’re on it",
  REFUND_PROCESSING: "Refund processing",
  REFUNDED: "Refunded",
  CANCELLED: "Cancelled",
  FAILED: "Needs attention",
};

/** Short, student-friendly label for any PrintJob status. */
export function printStatusLabel(status: string) {
  return STUDENT_PRINT_STEPS.find((step) => step.status === status)?.label ?? OTHER_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

export const PRINT_TRACKING_TERMINAL = ["DELIVERED", "REFUNDED", "CANCELLED", "FAILED"] as const;

export function studentPrintProgress(status: string, reachedStatuses: readonly string[] = []) {
  const currentIndex = STUDENT_PRINT_STEPS.findIndex((step) => step.status === status);
  // For an issue state, the furthest happy-path step reached so far stays visible.
  const furthestReached = Math.max(
    currentIndex,
    ...reachedStatuses.map((reached) => STUDENT_PRINT_STEPS.findIndex((step) => step.status === reached)),
  );
  return {
    steps: STUDENT_PRINT_STEPS.map((step, index) => ({
      ...step,
      state: index > furthestReached
        ? "upcoming" as const
        : index === currentIndex && status !== "DELIVERED"
          ? "current" as const
          : "done" as const,
    })),
    issue: ISSUE_MESSAGES[status] ?? null,
    isTerminal: (PRINT_TRACKING_TERMINAL as readonly string[]).includes(status),
  };
}
