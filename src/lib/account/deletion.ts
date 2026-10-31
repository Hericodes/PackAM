import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { deletePrivatePrintDocument } from "../printing/document";
import { transitionPrintJobInTransaction } from "../printing/status";
import { canTransitionPrintJob } from "../printing/status-machine";
import {
  INCIDENT_OPEN_STATUSES,
  ORDER_REFUNDABLE_STATUSES,
  ORDER_SETTLED_STATUSES,
  PAYMENT_CAPTURED_STATUSES,
  PAYMENT_OPEN_STATUSES,
  PRINT_JOB_ACTIVE_STATUSES,
  PRINT_JOB_CANCEL_BLOCKING_PAYMENT_STATUSES,
  PRINT_JOB_FINISHED_STATUSES,
  PRINT_JOB_REFUNDABLE_STATUSES,
  PRINT_JOB_UNPAID_STATUSES,
  PRODUCT_REQUEST_CANCELLABLE_STATUSES,
  REFUND_UNSETTLED_STATUSES,
  SUPPORT_CASE_OPEN_STATUSES,
  deletedAccountEmail,
  deletionBlockers,
  type DeletionBlocker,
} from "./deletion-policy";

/**
 * A student deleting their own account (the route checks the role and the password first). The User row can never be
 * removed: orders, payments, print documents, support cases and audit rows point at it, and the database refuses.
 * So the account is anonymised in place, in one serializable transaction that re-checks every blocker first: names,
 * phone, password and email confirmation are cleared, the email becomes an undeliverable placeholder, the account is
 * DEACTIVATED and its session version bumped (every device is signed out). Saved addresses, the cart, notifications
 * and emailed links are deleted; unanswered product requests and never-paid print jobs are cancelled. Orders,
 * payments, refunds, print jobs, support cases and audit rows are kept, with the delivery details on them.
 */

export const ACCOUNT_DELETED_AUDIT_ACTION = "ACCOUNT_DELETED";

type BlockerStore = Pick<Prisma.TransactionClient, "order" | "printJob" | "payment" | "paymentReviewCase" | "refund" | "supportCase" | "incident">;

/** Why this account can't be deleted yet (empty when it can). Pass the deleting transaction, or db for a preview. */
export async function findDeletionBlockers(tx: BlockerStore, userId: string): Promise<DeletionBlocker[]> {
  // One query at a time: inside an interactive transaction Prisma runs them in sequence anyway.
  return deletionBlockers({
    ORDER_IN_PROGRESS: await tx.order.count({ where: { userId, status: { notIn: [...ORDER_SETTLED_STATUSES] } } }),
    ORDER_NOT_REFUNDED: await tx.order.count({
      where: {
        userId,
        status: { in: [...ORDER_REFUNDABLE_STATUSES] },
        payment: { is: { status: { in: [...PAYMENT_CAPTURED_STATUSES] } } },
        refunds: { none: { status: "COMPLETED" } },
      },
    }),
    PRINT_JOB_IN_PROGRESS: await tx.printJob.count({ where: { userId, status: { in: [...PRINT_JOB_ACTIVE_STATUSES] } } }),
    PRINT_JOB_NOT_REFUNDED: await tx.printJob.count({
      where: { userId, status: { in: [...PRINT_JOB_REFUNDABLE_STATUSES] }, payments: { some: { status: "SUCCESS" } } },
    }),
    PAYMENT_PENDING: await tx.payment.count({ where: { userId, status: { in: [...PAYMENT_OPEN_STATUSES] } } }),
    // Legacy only: the database now refuses a successful payment with nothing it paid for.
    PAYMENT_UNMATCHED: await tx.payment.count({ where: { userId, status: "SUCCESS", orderId: null, printJobId: null } }),
    PAYMENT_UNDER_REVIEW: await tx.paymentReviewCase.count({ where: { status: "OPEN", payment: { is: { userId } } } }),
    REFUND_UNSETTLED: await tx.refund.count({ where: { status: { in: [...REFUND_UNSETTLED_STATUSES] }, order: { is: { userId } } } }),
    SUPPORT_CASE_OPEN: await tx.supportCase.count({ where: { userId, status: { in: [...SUPPORT_CASE_OPEN_STATUSES] } } }),
    INCIDENT_OPEN: await tx.incident.count({ where: { status: { in: [...INCIDENT_OPEN_STATUSES] }, order: { is: { userId } } } }),
  });
}

export type AccountDeletionResult =
  /** Done. `email` and `firstName` are the values from before, for the goodbye email only. */
  | { kind: "DELETED"; email: string; firstName: string | null }
  | { kind: "BLOCKED"; blockers: DeletionBlocker[] }
  /** Not an active student account (any more): nothing was changed. */
  | { kind: "UNAVAILABLE" };

/**
 * Deletes the student's account as described above, or reports why it can't yet. Retried on serialization
 * conflicts; each attempt re-reads everything, so a payment or order that lands meanwhile blocks it.
 */
export async function deleteAccount(userId: string): Promise<AccountDeletionResult> {
  return retrySerializable(() => db.$transaction(async (tx): Promise<AccountDeletionResult> => {
    const user = await tx.user.findFirst({ where: { id: userId, role: "STUDENT", status: "ACTIVE" }, select: { id: true, email: true, firstName: true } });
    if (!user) return { kind: "UNAVAILABLE" };
    const blockers = await findDeletionBlockers(tx, user.id);
    if (blockers.length) return { kind: "BLOCKED", blockers };

    // Never-paid print jobs are cancelled through the normal status change (history row, document expiry), but only
    // when no payment could still complete them, the same rule as a student cancelling one. Others are left alone.
    const unpaidJobs = await tx.printJob.findMany({
      where: {
        userId: user.id,
        status: { in: [...PRINT_JOB_UNPAID_STATUSES] },
        payments: { none: { status: { in: [...PRINT_JOB_CANCEL_BLOCKING_PAYMENT_STATUSES] } } },
      },
      select: { id: true, status: true },
    });
    let cancelledPrintJobs = 0;
    for (const job of unpaidJobs) {
      if (!canTransitionPrintJob(job.status, "CANCELLED")) continue;
      await transitionPrintJobInTransaction(tx, {
        printJobId: job.id,
        toStatus: "CANCELLED",
        actorId: user.id,
        note: "Cancelled because the student deleted their PackAM account.",
        guard: { status: { in: [...PRINT_JOB_UNPAID_STATUSES] } },
      });
      cancelledPrintJobs += 1;
    }
    const productRequests = await tx.productRequest.updateMany({
      where: { userId: user.id, status: { in: [...PRODUCT_REQUEST_CANCELLABLE_STATUSES] } },
      data: { status: "CANCELLED" },
    });

    // Orders keep their own copy of the delivery address; deleting a saved one only unlinks it (SET NULL).
    const savedLocations = await tx.savedLocation.deleteMany({ where: { userId: user.id } });
    // Cart items and their extras go with the cart.
    const carts = await tx.cart.deleteMany({ where: { userId: user.id } });
    const notifications = await tx.notification.deleteMany({ where: { userId: user.id } });
    const accountTokens = await tx.accountToken.deleteMany({ where: { userId: user.id } });
    await tx.studentProfile.updateMany({ where: { userId: user.id }, data: { matricNumber: null, department: null, faculty: null, level: null } });
    const anonymised = await tx.user.updateMany({
      where: { id: user.id, role: "STUDENT", status: "ACTIVE" },
      data: {
        status: "DEACTIVATED",
        email: deletedAccountEmail(user.id),
        firstName: null,
        lastName: null,
        phone: null,
        passwordHash: null,
        emailVerifiedAt: null,
        // Every session cookie carries the version it was issued with, so all of them stop working.
        sessionVersion: { increment: 1 },
      },
    });
    if (anonymised.count !== 1) throw new Error("The account changed while it was being deleted.");

    // Counts only: nothing personal goes into the audit trail (admins can read it).
    await writeAuditLog(tx, {
      actorId: user.id,
      action: ACCOUNT_DELETED_AUDIT_ACTION,
      resource: "User",
      resourceId: user.id,
      previousState: { status: "ACTIVE" },
      newState: {
        status: "DEACTIVATED",
        removed: { savedLocations: savedLocations.count, carts: carts.count, notifications: notifications.count, accountTokens: accountTokens.count },
        cancelled: { productRequests: productRequests.count, printJobs: cancelledPrintJobs },
      },
      details: "The student deleted their account. Personal details were removed; orders, payments, print jobs and support history were kept.",
    });
    return { kind: "DELETED", email: user.email, firstName: user.firstName };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }), { attempts: 5, baseDelayMs: 25 });
}

/**
 * After a deletion has committed: removes the uploaded PDFs of the account's finished print jobs from storage and
 * marks each document deleted (the rows stay, as when a student replaces a document). Best effort: a failure is
 * logged by error name and the next document is tried. Only for a DEACTIVATED account, so nothing in progress, and
 * no active account, can lose a file. `deleteFile` is replaceable for tests.
 */
export async function removeDeletedAccountDocuments(
  userId: string,
  deleteFile: (publicId: string) => Promise<void> = deletePrivatePrintDocument,
): Promise<{ removed: number; failed: number }> {
  const documents = await db.printDocument.findMany({
    where: { deletedAt: null, printJob: { userId, status: { in: [...PRINT_JOB_FINISHED_STATUSES] }, user: { status: "DEACTIVATED" } } },
    select: { id: true, publicId: true },
  });
  let removed = 0;
  let failed = 0;
  for (const document of documents) {
    try {
      await deleteFile(document.publicId);
      await db.printDocument.updateMany({ where: { id: document.id, deletedAt: null }, data: { deletedAt: new Date() } });
      removed += 1;
    } catch (error) {
      failed += 1;
      console.error("DELETED ACCOUNT DOCUMENT CLEANUP ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
  }
  return { removed, failed };
}
