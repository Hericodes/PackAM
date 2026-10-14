import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { writeAuditLog } from "../audit";
import { createNotification, notifyAdmins } from "../notifications";
import { getRunnerAcceptanceTimeoutMinutes } from "../orders/price-policy";
import { printMissionReference } from "./runner-mission-policy";
import { canTransitionPrintJob } from "./status-machine";
import { transitionPrintJobInTransaction } from "./status";

type Tx = Prisma.TransactionClient;

/**
 * Moves a paid print job into REFUND_PROCESSING and stops fulfilment.
 *
 * The Refund model is tied to marketplace Orders and there is no OPay refund API in this
 * codebase, so no refund record is created and nothing is marked refunded here. Operations
 * complete the refund with the provider manually; the job stays visibly in REFUND_PROCESSING.
 */
export async function startPrintRefundProcessing(
  tx: Tx,
  input: { printJobId: string; reason: string; actorId?: string | null; note: string },
) {
  const job = await tx.printJob.findUnique({
    where: { id: input.printJobId },
    select: {
      id: true,
      status: true,
      total: true,
      assignedRunner: { select: { userId: true } },
      payments: { where: { status: "SUCCESS" }, select: { id: true, amount: true, transactionReference: true }, take: 1 },
    },
  });
  if (!job) throw new Error("Print job not found.");
  if (job.status === "REFUND_PROCESSING" || job.status === "REFUNDED") return { alreadyStarted: true };
  const payment = job.payments[0];
  if (!payment || job.total === null || payment.amount !== job.total) {
    throw new Error("Only a print job with a verified captured payment can enter refund processing.");
  }
  if (!canTransitionPrintJob(job.status, "REFUND_PROCESSING")) {
    throw new Error(`Print job cannot move from ${job.status} to REFUND_PROCESSING.`);
  }

  await transitionPrintJobInTransaction(tx, {
    printJobId: job.id,
    toStatus: "REFUND_PROCESSING",
    actorId: input.actorId ?? null,
    note: input.note,
  });
  await tx.runnerAssignment.updateMany({
    where: { printJobId: job.id, status: { in: ["OFFERED", "ACCEPTED"] } },
    data: { status: "CANCELLED" },
  });
  const reference = printMissionReference(job.id);
  if (job.assignedRunner) {
    await createNotification(tx, {
      userId: job.assignedRunner.userId,
      type: "DELIVERY",
      title: "Print mission cancelled",
      message: `Print job ${reference} has moved to refund processing. Please stop fulfilment.`,
      relatedType: "PRINT_JOB",
      relatedId: job.id,
      idempotencyKey: `print-refund-runner-cancel:${job.id}`,
    });
  }
  await notifyAdmins(tx, {
    type: "PAYMENT",
    title: "Print refund needs processing",
    message: `Print job ${reference} (₦${payment.amount.toLocaleString()}, ${input.reason}) needs a manual OPay refund.`,
    relatedType: "PRINT_JOB",
    relatedId: job.id,
    idempotencyKey: `print-refund-admin:${job.id}`,
  });
  return { alreadyStarted: false };
}

export async function adminStartPrintRefund(adminId: string, printJobId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.printJob.findUnique({ where: { id: printJobId }, select: { status: true } });
    if (!before) throw new Error("Print job not found.");
    const result = await startPrintRefundProcessing(tx, {
      printJobId,
      reason: "ADMIN_REVIEW",
      actorId: adminId,
      note: "Operations moved the print job to refund processing.",
    });
    if (!result.alreadyStarted) {
      await writeAuditLog(tx, {
        actorId: adminId,
        action: "PRINT_REFUND_PROCESSING_STARTED",
        resource: "PrintJob",
        resourceId: printJobId,
        previousState: { status: before.status },
        newState: { status: "REFUND_PROCESSING" },
      });
    }
    return { status: "REFUND_PROCESSING" as const, alreadyStarted: result.alreadyStarted };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Sends a failed or unreadable job back to the same assigned runner after operations review. */
export async function adminRetryPrintJob(adminId: string, printJobId: string) {
  return db.$transaction(async (tx) => {
    const job = await tx.printJob.findUnique({
      where: { id: printJobId },
      select: { id: true, status: true, assignedRunnerId: true, assignedRunner: { select: { userId: true } } },
    });
    if (!job) throw new Error("Print job not found.");
    if (job.status !== "DOCUMENT_UNREADABLE" && job.status !== "PRINT_FAILED") {
      throw new Error("Only an unreadable or failed print job can be retried.");
    }
    if (!job.assignedRunnerId) throw new Error("This print job has no assigned runner to retry with.");
    const assignment = await tx.runnerAssignment.findUnique({
      where: { printJobId_runnerId: { printJobId, runnerId: job.assignedRunnerId } },
      select: { status: true },
    });
    if (assignment?.status !== "ACCEPTED") throw new Error("The runner assignment is no longer active.");
    await transitionPrintJobInTransaction(tx, {
      printJobId,
      toStatus: "RUNNER_ASSIGNED",
      actorId: adminId,
      note: "Operations reviewed the issue and asked the runner to retry.",
      guard: { assignedRunnerId: job.assignedRunnerId },
    });
    await writeAuditLog(tx, {
      actorId: adminId,
      action: "PRINT_JOB_RETRY",
      resource: "PrintJob",
      resourceId: printJobId,
      previousState: { status: job.status },
      newState: { status: "RUNNER_ASSIGNED" },
    });
    if (job.assignedRunner) {
      const history = await tx.printJobStatusHistory.count({ where: { printJobId, status: "RUNNER_ASSIGNED" } });
      await createNotification(tx, {
        userId: job.assignedRunner.userId,
        type: "DELIVERY",
        title: "Print mission back on",
        message: `PackAM operations asked you to retry print job ${printMissionReference(printJobId)}.`,
        relatedType: "PRINT_JOB",
        relatedId: printJobId,
        idempotencyKey: `print-retry:${printJobId}:${history}`,
      });
    }
    return { status: "RUNNER_ASSIGNED" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Call periodically from the fulfilment scheduler. Safe to run repeatedly. */
export async function expireUnclaimedPrintJobs(now = new Date()) {
  const cutoff = new Date(now.getTime() - getRunnerAcceptanceTimeoutMinutes() * 60_000);
  const overdue = await db.printJob.findMany({
    where: { status: "FINDING_RUNNER", assignedRunnerId: null, findingRunnerAt: { lte: cutoff } },
    select: { id: true },
    take: 100,
    orderBy: { findingRunnerAt: "asc" },
  });

  let started = 0;
  for (const candidate of overdue) {
    try {
      const changed = await db.$transaction(async (tx) => {
        const current = await tx.printJob.findUnique({
          where: { id: candidate.id },
          select: { status: true, assignedRunnerId: true, findingRunnerAt: true },
        });
        if (!current || current.status !== "FINDING_RUNNER" || current.assignedRunnerId || !current.findingRunnerAt || current.findingRunnerAt > cutoff) {
          return false;
        }
        await startPrintRefundProcessing(tx, {
          printJobId: candidate.id,
          reason: "NO_RUNNER",
          note: "No eligible runner accepted this print mission before its deadline.",
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (changed) started++;
    } catch (error) {
      console.error("PRINT RUNNER TIMEOUT PROCESSING ERROR:", candidate.id, error instanceof Error ? error.name : "Unknown error");
    }
  }
  return { scanned: overdue.length, refundProcessingStarted: started };
}
