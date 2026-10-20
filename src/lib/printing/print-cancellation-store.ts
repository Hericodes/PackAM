import "server-only";

import { PaymentProvider, Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { createNotification } from "../notifications";
import { opayStatusDeps } from "../payments/checkout-cancellation-store";
import { checkOpayPaymentStatus, type VerificationDeps } from "../payments/opay-verification";
import { transitionPrintJobInTransaction } from "./status";
import { printMissionReference } from "./runner-mission-policy";
import type { PrintCancellationDeps, PrintCancelWriteResult, PrintJobPaymentView } from "./print-cancellation";

export type PrintCancelActor = { id: string; role: "STUDENT" | "ADMIN" };

export const PRINT_UNPAID_CANCEL_AUDIT_ACTION = "PRINT_UNPAID_CANCELLED";

/** Students reach only their own jobs; another student's job is simply not found. Admins reach any job. */
function jobScope(printJobId: string, actor: PrintCancelActor): Prisma.PrintJobWhereInput {
  return actor.role === "ADMIN" ? { id: printJobId } : { id: printJobId, userId: actor.id };
}

async function loadJob(printJobId: string, actor: PrintCancelActor) {
  return db.printJob.findFirst({
    where: jobScope(printJobId, actor),
    select: {
      id: true,
      status: true,
      payments: {
        where: { provider: PaymentProvider.OPAY },
        select: { status: true, transactionReference: true, amount: true, currency: true, providerCheckoutReference: true },
      },
    },
  });
}

async function cancelInTransaction(printJobId: string, actor: PrintCancelActor): Promise<PrintCancelWriteResult> {
  return retrySerializable(() => db.$transaction(async (tx) => {
    const job = await tx.printJob.findFirst({ where: jobScope(printJobId, actor), select: { id: true, userId: true, status: true, total: true } });
    if (!job) return "NOT_CANCELLABLE";
    if (job.status === "CANCELLED") return "ALREADY_CANCELLED";
    if (job.status !== "DRAFT" && job.status !== "READY_FOR_PAYMENT") return "NOT_CANCELLABLE";
    // Re-checked inside the transaction: a payment that is open, under review or paid blocks cancelling.
    const blocking = await tx.payment.findFirst({
      where: { printJobId: job.id, status: { in: ["PENDING", "RECONCILIATION_REQUIRED", "SUCCESS", "REFUNDED"] } },
      select: { id: true },
    });
    if (blocking) return "NOT_CANCELLABLE";

    const byAdmin = actor.role === "ADMIN";
    await transitionPrintJobInTransaction(tx, {
      printJobId: job.id,
      toStatus: "CANCELLED",
      actorId: actor.id,
      note: byAdmin ? "Cancelled by PackAM operations: payment did not complete." : "Cancelled by the student: payment did not complete.",
      guard: { status: { in: ["DRAFT", "READY_FOR_PAYMENT"] } },
    });
    await writeAuditLog(tx, {
      actorId: actor.id,
      action: PRINT_UNPAID_CANCEL_AUDIT_ACTION,
      resource: "PrintJob",
      resourceId: job.id,
      previousState: { status: job.status },
      newState: { status: "CANCELLED" },
      details: byAdmin ? "Admin cancelled an unpaid print job." : "Student cancelled an unpaid print job.",
    });
    await createNotification(tx, {
      userId: job.userId,
      type: "ORDER",
      title: "Print job cancelled",
      message: `Print job ${printMissionReference(job.id)} is cancelled and won’t be printed. ${byAdmin ? "PackAM cancelled it because the payment didn’t complete." : "No wahala — start a new one whenever you’re ready."}`,
      relatedType: "PRINT_JOB",
      relatedId: job.id,
      idempotencyKey: `print-job-cancelled:${job.id}`,
    });
    return "CANCELLED";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 6, baseDelayMs: 25 });
}

export function printCancellationDeps(printJobId: string, actor: PrintCancelActor, verification: VerificationDeps = opayStatusDeps): PrintCancellationDeps {
  return {
    async findJob(): Promise<PrintJobPaymentView | null> {
      const job = await loadJob(printJobId, actor);
      return job && { jobStatus: job.status, payments: job.payments.map((payment) => payment.status) };
    },
    async reconcilePending() {
      const job = await loadJob(printJobId, actor);
      for (const payment of job?.payments ?? []) {
        if (payment.status !== "PENDING" || !payment.transactionReference) continue;
        // Same trusted path as the status poll: provider trouble is logged and leaves the attempt pending.
        await checkOpayPaymentStatus(
          { reference: payment.transactionReference, amount: payment.amount, currency: payment.currency, providerCheckoutReference: payment.providerCheckoutReference },
          verification,
        );
      }
    },
    cancel: () => cancelInTransaction(printJobId, actor),
  };
}
