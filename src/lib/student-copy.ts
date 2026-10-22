/**
 * Student-facing wording, in one place so every screen speaks with the same voice: a sharp Nigerian
 * campus friend — English with natural Pidgin, helpful first and funny second.
 *
 * Voice rules:
 * - Personality lives in supporting lines. Anything about money, refunds, payment results, security or
 *   a required action is stated plainly in English, so it can never be misread.
 * - Never joke about a student's money, grades or problems. Prices, references and statuses stay exact.
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
      return "Payment confirmed ✓ Order don enter! We dey find a runner for you.";
    case "RUNNER_ASSIGNED":
      return `Person don accept the mission 🫡 ${runner} is on it.`;
    case "SOURCING_PRODUCT":
      return "We don dey find your stuff 👀 If anything changes, you’ll hear from us here.";
    case "OUT_FOR_DELIVERY":
      return `${runner} don comot with your order 🛵 Keep your phone close.`;
    case "DELIVERED":
      return "Your package don land! 🎒 Enjoy am.";
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

/**
 * Payment-state copy shared by the shop and print payment pages. Headlines say the result in plain
 * words; "please don’t pay again" stays plain English wherever a payment is unconfirmed.
 */
export const PAYMENT_COPY = {
  checkingTitle: "Confirming your payment…",
  checkingBody: "We dey confirm your payment. This usually takes under a minute — please don’t pay again.",
  pendingTitle: "Payment is still being confirmed",
  reviewTitle: "We’re checking this payment",
  reviewBody: "Our team needs to confirm this payment by hand. Please don’t pay again — if money left your account, it’s safe, and we’ll update you.",
  /** After polling stops: still unconfirmed, never described as failed or lost. */
  slowBody: (whatHappensNext: string) => `We never get payment confirmation yet — make we keep checking. Please don’t pay again. If money left your account, it’s safe: ${whatHappensNext} as soon as the payment is confirmed.`,
  successTitle: "Payment confirmed 🎉",
  failedTitle: "Payment no go through",
} as const;

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

/** What a timeline entry means to the student. Internal status notes stay operations-only. */
const ORDER_EVENT_DESCRIPTIONS: Record<string, string> = {
  PAYMENT_CONFIRMED: "Your payment was verified.",
  FINDING_RUNNER: "Your order was offered to campus runners.",
  RUNNER_ASSIGNED: "A runner accepted your order.",
  SOURCING_PRODUCT: "Your runner started getting your items.",
  OUT_FOR_DELIVERY: "Your runner left with your order.",
  DELIVERED: "Your runner marked the order as delivered.",
  REFUND_PROCESSING: "A refund was started.",
  REFUNDED: "Your refund was confirmed.",
  FAILED: "The refund needs attention from our team.",
  CANCELLED: "The order was cancelled.",
};

export function orderEventDescription(status: string) {
  return ORDER_EVENT_DESCRIPTIONS[status] ?? null;
}

/** The next thing that will happen, phrased so it never promises a time or a result. */
export function orderNextStep(status: string) {
  switch (status) {
    case "PAYMENT_CONFIRMED":
    case "FINDING_RUNNER":
      return "A verified campus runner will accept your order. You’ll get a notification when they do.";
    case "RUNNER_ASSIGNED":
      return "Your runner will start getting your items from the vendor.";
    case "SOURCING_PRODUCT":
      return "Your runner is getting your items. If a price has changed, you’ll be asked to approve it on this page before they continue.";
    case "OUT_FOR_DELIVERY":
      return "Your runner is bringing the order to your delivery address. Keep your phone close.";
    case "DELIVERED":
      return "Nothing else to do. If something is wrong with your items, report it to support with this order.";
    case "REFUND_PROCESSING":
      return "You’ll get a notification when the refund is confirmed.";
    case "REFUNDED":
      return "Nothing else to do — this order is closed.";
    case "FAILED":
      return "Our team is handling the refund. Contact support with this order if you have questions.";
    case "CANCELLED":
      return "This order is closed. Contact support if you think that’s a mistake.";
    default:
      return null;
  }
}

/** Collapses repeated statuses (e.g. a re-offer to runners) so the timeline reads as distinct steps. */
export function orderTimeline<T extends { status: string; createdAt: Date }>(history: T[]) {
  const sorted = history.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return sorted.filter((entry, index) => index === 0 || sorted[index - 1].status !== entry.status);
}
