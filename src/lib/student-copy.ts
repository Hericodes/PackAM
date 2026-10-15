/**
 * Student-facing wording for order states, in one place so every screen speaks with the same voice.
 * Roughly 80% clarity, 20% personality — and never playful about money, refunds or failures.
 */

const ORDER_LABELS: Record<string, string> = {
  PAYMENT_CONFIRMED: "Payment confirmed",
  FINDING_RUNNER: "Finding a runner",
  RUNNER_ASSIGNED: "Runner assigned",
  SOURCING_PRODUCT: "Getting your items",
  OUT_FOR_DELIVERY: "On the way",
  DELIVERED: "Delivered",
  REFUND_PROCESSING: "Refund processing",
  REFUNDED: "Refunded",
  // An order only exists after payment succeeded; FAILED is reached from REFUND_PROCESSING.
  FAILED: "Refund needs attention",
  CANCELLED: "Cancelled",
};

export function orderStatusLabel(status: string) {
  return ORDER_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

export function orderStatusMessage(status: string, context: { total: number; runnerName?: string | null }) {
  const runner = context.runnerName?.trim() || "Your runner";
  switch (status) {
    case "PAYMENT_CONFIRMED":
    case "FINDING_RUNNER":
      return "Payment confirmed ✓ We’re finding a runner for your order.";
    case "RUNNER_ASSIGNED":
      return `Someone has accepted the mission 🫡 ${runner} is on it.`;
    case "SOURCING_PRODUCT":
      return "We don dey find your stuff. If anything changes, you’ll hear from us here.";
    case "OUT_FOR_DELIVERY":
      return `${runner} is on the way. Keep your phone close.`;
    case "DELIVERED":
      return "Your package don land 🎒 Enjoy!";
    case "REFUND_PROCESSING":
      return `We’ve started your refund of ₦${context.total.toLocaleString()}. We’ll notify you as soon as it’s confirmed.`;
    case "REFUNDED":
      return `Your refund of ₦${context.total.toLocaleString()} has been confirmed.`;
    case "FAILED":
      return "Your refund hit a problem. Our team is on it — you don’t need to pay again. If you have questions, contact support with this order reference.";
    case "CANCELLED":
      return "This order was cancelled.";
    default:
      return "We’ll post every update for this order here.";
  }
}

export const ORDER_FINAL_STATUSES = ["DELIVERED", "REFUNDED", "CANCELLED", "FAILED"] as const;

export function isFinalOrderStatus(status: string) {
  return (ORDER_FINAL_STATUSES as readonly string[]).includes(status);
}

/** Server-rendered times must be shown in campus time, not the server's timezone. */
export function formatCampusTime(date: Date) {
  return date.toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
}

export function shortReference(id: string) {
  return id.slice(-8).toUpperCase();
}

export const ORDER_PROGRESS_STEPS = [
  { status: "FINDING_RUNNER", label: "Paid" },
  { status: "RUNNER_ASSIGNED", label: "Runner assigned" },
  { status: "SOURCING_PRODUCT", label: "Getting your items" },
  { status: "OUT_FOR_DELIVERY", label: "On the way" },
  { status: "DELIVERED", label: "Delivered" },
] as const;

/**
 * Progress for the order tracker. Refunds, cancellations and failures are not points on the
 * delivery path, so they return no steps and the page explains them in words instead.
 */
export function orderProgress(status: string) {
  const normalised = status === "PAYMENT_CONFIRMED" ? "FINDING_RUNNER" : status;
  const index = ORDER_PROGRESS_STEPS.findIndex((step) => step.status === normalised);
  if (index === -1) return null;
  return ORDER_PROGRESS_STEPS.map((step, position) => ({
    label: step.label,
    state: position < index || (position === index && normalised === "DELIVERED") ? ("done" as const) : position === index ? ("current" as const) : ("upcoming" as const),
  }));
}
