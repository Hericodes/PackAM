/**
 * When a student can delete their PackAM account, and what deleting changes. Pure (no I/O), so the rules are
 * unit-tested; src/lib/account/deletion.ts runs the matching queries inside the deleting transaction.
 *
 * Deleting never removes an order, payment, refund, print job, support case or audit row: those are needed for
 * accounting and disputes, and the database refuses to drop most of them anyway. The account is anonymised in
 * place instead, and only once nothing is in flight and no money may still be owed. CANCELLED and FAILED orders
 * and print jobs can still move to REFUND_PROCESSING (src/lib/orders/state-machine.ts,
 * src/lib/printing/status-machine.ts), and refunds are settled in the provider dashboard, so PackAM's data never
 * shows them COMPLETED: those cases need support. Every message says what to do next.
 */
import type {
  IncidentStatus,
  OrderStatus,
  PaymentStatus,
  PrintJobStatus,
  ProductRequestStatus,
  RefundStatus,
  SupportCaseStatus,
} from "@prisma/client";

// ---- What blocks deleting ----

/** Orders that need nothing more. Any other status is still in progress. */
export const ORDER_SETTLED_STATUSES = ["DELIVERED", "REFUNDED", "CANCELLED", "FAILED"] as const satisfies readonly OrderStatus[];
/** Settled orders that can still be refunded: they block while their payment took money and no refund completed. */
export const ORDER_REFUNDABLE_STATUSES = ["CANCELLED", "FAILED"] as const satisfies readonly OrderStatus[];
/** A payment that took, or may have taken, the student’s money. */
export const PAYMENT_CAPTURED_STATUSES = ["SUCCESS", "RECONCILIATION_REQUIRED"] as const satisfies readonly PaymentStatus[];
/** Paid print jobs that aren’t finished yet. */
export const PRINT_JOB_ACTIVE_STATUSES = [
  "PAYMENT_CONFIRMED",
  "FINDING_RUNNER",
  "RUNNER_ASSIGNED",
  "DOCUMENT_RECEIVED",
  "PRINTING",
  "PRINTED",
  "OUT_FOR_DELIVERY",
  "DOCUMENT_UNREADABLE",
  "PRINT_FAILED",
  "REFUND_PROCESSING",
] as const satisfies readonly PrintJobStatus[];
/** Finished print jobs that can still be refunded: they block while a payment for them succeeded. */
export const PRINT_JOB_REFUNDABLE_STATUSES = ["CANCELLED", "FAILED"] as const satisfies readonly PrintJobStatus[];
/** Payments that can still capture money (a late capture creates an order) or that need a person to look. */
export const PAYMENT_OPEN_STATUSES = ["PENDING", "RECONCILIATION_REQUIRED"] as const satisfies readonly PaymentStatus[];
export const REFUND_UNSETTLED_STATUSES = ["PENDING", "PROCESSING", "FAILED"] as const satisfies readonly RefundStatus[];
export const SUPPORT_CASE_OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "ESCALATED"] as const satisfies readonly SupportCaseStatus[];
export const INCIDENT_OPEN_STATUSES = ["OPEN", "INVESTIGATING"] as const satisfies readonly IncidentStatus[];

// ---- What deleting changes ----

/** Product requests nobody has answered yet: cancelled, never deleted (the database keeps them with the account). */
export const PRODUCT_REQUEST_CANCELLABLE_STATUSES = ["PENDING", "CHECKING"] as const satisfies readonly ProductRequestStatus[];
/** Print jobs that were never paid for. */
export const PRINT_JOB_UNPAID_STATUSES = ["DRAFT", "READY_FOR_PAYMENT"] as const satisfies readonly PrintJobStatus[];
/**
 * An unpaid print job is cancelled only when none of its payments is in one of these: the same rule as a student
 * cancelling it themselves (src/lib/printing/print-cancellation-store.ts). Otherwise it is left as it is.
 */
export const PRINT_JOB_CANCEL_BLOCKING_PAYMENT_STATUSES = ["PENDING", "RECONCILIATION_REQUIRED", "SUCCESS", "REFUNDED"] as const satisfies readonly PaymentStatus[];
/** Print jobs whose uploaded PDF is removed from storage once the account is deleted (the record stays). */
export const PRINT_JOB_FINISHED_STATUSES = ["DELIVERED", "REFUNDED", "CANCELLED", "FAILED"] as const satisfies readonly PrintJobStatus[];

// ---- Blockers ----

/** Every reason deleting can be refused, in the order they are listed (work in progress first). */
export const DELETION_BLOCKER_KINDS = [
  "ORDER_IN_PROGRESS",
  "ORDER_NOT_REFUNDED",
  "PRINT_JOB_IN_PROGRESS",
  "PRINT_JOB_NOT_REFUNDED",
  "PAYMENT_PENDING",
  "PAYMENT_UNMATCHED",
  "PAYMENT_UNDER_REVIEW",
  "REFUND_UNSETTLED",
  "SUPPORT_CASE_OPEN",
  "INCIDENT_OPEN",
] as const;

export type DeletionBlockerKind = (typeof DELETION_BLOCKER_KINDS)[number];
/** One reason the account can’t be deleted yet: `count` matching records, and a sentence saying what to do. */
export type DeletionBlocker = { kind: DeletionBlockerKind; message: string; count: number };

const MESSAGES: Record<DeletionBlockerKind, { one: string; many: (count: number) => string }> = {
  ORDER_IN_PROGRESS: {
    one: "You have an order in progress. You can delete your account once it’s delivered or cancelled.",
    many: (n) => `You have ${n} orders in progress. You can delete your account once they’re delivered or cancelled.`,
  },
  ORDER_NOT_REFUNDED: {
    one: "A cancelled order was paid for and hasn’t been refunded yet. Contact PackAM support so we can settle it first.",
    many: (n) => `${n} cancelled orders were paid for and haven’t been refunded yet. Contact PackAM support so we can settle them first.`,
  },
  PRINT_JOB_IN_PROGRESS: {
    one: "You have a print job in progress. You can delete your account once it’s finished.",
    many: (n) => `You have ${n} print jobs in progress. You can delete your account once they’re finished.`,
  },
  PRINT_JOB_NOT_REFUNDED: {
    one: "A cancelled print job was paid for and hasn’t been refunded yet. Contact PackAM support so we can settle it first.",
    many: (n) => `${n} cancelled print jobs were paid for and haven’t been refunded yet. Contact PackAM support so we can settle them first.`,
  },
  PAYMENT_PENDING: {
    one: "A payment is still being confirmed. Wait for it to finish, or contact PackAM support if it seems stuck.",
    many: (n) => `${n} payments are still being confirmed. Wait for them to finish, or contact PackAM support if they seem stuck.`,
  },
  PAYMENT_UNMATCHED: {
    one: "A payment needs checking by our team. Contact PackAM support before you delete your account.",
    many: (n) => `${n} payments need checking by our team. Contact PackAM support before you delete your account.`,
  },
  PAYMENT_UNDER_REVIEW: {
    one: "Our team is reviewing one of your payments. Contact PackAM support, or try again once the review is closed.",
    many: (n) => `Our team is reviewing ${n} of your payments. Contact PackAM support, or try again once the reviews are closed.`,
  },
  REFUND_UNSETTLED: {
    one: "A refund isn’t settled yet. Contact PackAM support so we can finish it first.",
    many: (n) => `${n} refunds aren’t settled yet. Contact PackAM support so we can finish them first.`,
  },
  SUPPORT_CASE_OPEN: {
    one: "You have an open support request. Wait for it to be resolved, or ask PackAM support to close it.",
    many: (n) => `You have ${n} open support requests. Wait for them to be resolved, or ask PackAM support to close them.`,
  },
  INCIDENT_OPEN: {
    one: "A problem with one of your deliveries is still being looked into. Contact PackAM support so we can close it first.",
    many: (n) => `${n} problems with your deliveries are still being looked into. Contact PackAM support so we can close them first.`,
  },
};

/** The sentence shown for a blocker, worded for how many records it covers. */
export function deletionBlockerMessage(kind: DeletionBlockerKind, count = 1): string {
  const message = MESSAGES[kind];
  return count > 1 ? message.many(count) : message.one;
}

/** The blockers for the given record counts, in DELETION_BLOCKER_KINDS order. Kinds without a positive count are left out. */
export function deletionBlockers(counts: Partial<Record<DeletionBlockerKind, number>>): DeletionBlocker[] {
  return DELETION_BLOCKER_KINDS.flatMap((kind) => {
    const count = counts[kind] ?? 0;
    return Number.isInteger(count) && count > 0 ? [{ kind, message: deletionBlockerMessage(kind, count), count }] : [];
  });
}

// ---- The deleted account ----

/**
 * The email a deleted account keeps. User.email is required and unique, so it is made from the account id; the
 * .invalid top-level name can never receive mail (RFC 2606), and nobody can sign in or register with it.
 */
export function deletedAccountEmail(userId: string): string {
  return `deleted-${userId}@deleted.packam.invalid`;
}

/** What the person types to confirm. */
export const DELETE_CONFIRMATION = "DELETE";

/** True for the typed confirmation. Spaces around it and letter case are forgiven (phone keyboards capitalise). */
export function isDeleteConfirmation(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === DELETE_CONFIRMATION;
}
