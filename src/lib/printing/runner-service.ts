import "server-only";
import { offerCutoff } from "../orders/dispatch-policy";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { isSerializationFailure, retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { createNotification, notifyAdmins } from "../notifications";
import { getRunnerAcceptanceTimeoutMinutes } from "../orders/price-policy";
import { createPrivatePrintDocumentDownloadUrl } from "./document";
import { transitionPrintJobInTransaction } from "./status";
import {
  decidePrintAcceptance,
  planPrintMissionIssue,
  planPrintMissionStep,
  printMissionReference,
  runnerMayAccessPrintDocument,
  sanitizeIssueNote,
  toRunnerPrintMissionView,
  type PrintMissionIssueAction,
  type PrintMissionStepAction,
} from "./runner-mission-policy";

type Tx = Prisma.TransactionClient;

/** An expected, user-facing failure. Anything else is reported generically by the routes. */
export class PrintMissionError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409 = 409) {
    super(message);
    this.name = "PrintMissionError";
  }
}

const STALE_TRANSITION = /status changed while this action|cannot move from/i;

/**
 * Serializable transactions abort when runners race; retrySerializable re-runs them so exactly one
 * wins and the others re-read committed state and get a clear conflict instead of a generic error.
 */
async function serializable<T>(work: (tx: Tx) => Promise<T>, staleMessage: string): Promise<T> {
  try {
    return await retrySerializable(() => db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (isSerializationFailure(error)) throw new PrintMissionError("Lots of runners are on this right now. Try again in a moment.");
    if (error instanceof Error && !(error instanceof PrintMissionError) && STALE_TRANSITION.test(error.message)) {
      throw new PrintMissionError(staleMessage);
    }
    throw error;
  }
}

async function activeRunner(tx: Tx, userId: string) {
  const runner = await tx.runnerProfile.findFirst({
    where: { userId, isVerified: true, user: { role: "RUNNER", status: "ACTIVE" } },
    select: { id: true, userId: true, isAvailable: true },
  });
  if (!runner) throw new PrintMissionError("Your runner profile is not active and verified.", 403);
  return runner;
}

/**
 * A runner turns down an open print offer: it becomes REJECTED (never re-offered to them) and the job is
 * redispatched to other eligible runners in the same transaction.
 */
export async function declinePrintMission(userId: string, printJobId: string) {
  return serializable(async (tx) => {
    const runner = await activeRunner(tx, userId);
    const declined = await tx.runnerAssignment.updateMany({ where: { printJobId, runnerId: runner.id, status: "OFFERED" }, data: { status: "REJECTED" } });
    if (declined.count !== 1) throw new PrintMissionError("This mission is no longer available.", 409);
    const { dispatchPrintJobInTransaction } = await import("../orders/dispatch");
    const redispatch = await dispatchPrintJobInTransaction(tx, printJobId);
    return { declined: true, redispatch: redispatch.outcome };
  }, "This mission just changed. Refresh and try again.");
}

export async function acceptPrintMission(userId: string, printJobId: string) {
  return serializable(async (tx) => {
    const runner = await activeRunner(tx, userId);
    const [assignment, job] = await Promise.all([
      tx.runnerAssignment.findUnique({
        where: { printJobId_runnerId: { printJobId, runnerId: runner.id } },
        select: { id: true, status: true, offeredAt: true },
      }),
      tx.printJob.findUnique({
        where: { id: printJobId },
        select: { id: true, status: true, assignedRunnerId: true, findingRunnerAt: true },
      }),
    ]);
    const decision = decidePrintAcceptance({
      runner,
      assignment,
      job,
      now: new Date(),
      timeoutMinutes: getRunnerAcceptanceTimeoutMinutes(),
    });
    if (decision.kind === "rejected") throw new PrintMissionError(decision.message, decision.status);
    if (decision.kind === "already-accepted") return { accepted: true, alreadyAccepted: true, status: job!.status };

    // The guarded conditional update is the single-winner gate: only one transaction can move
    // FINDING_RUNNER with no assigned runner to RUNNER_ASSIGNED.
    await transitionPrintJobInTransaction(tx, {
      printJobId,
      toStatus: "RUNNER_ASSIGNED",
      actorId: userId,
      note: "A verified runner accepted the print mission.",
      guard: { status: "FINDING_RUNNER", assignedRunnerId: null },
      data: { assignedRunnerId: runner.id },
    });
    const accepted = await tx.runnerAssignment.updateMany({
      where: { id: assignment!.id, runnerId: runner.id, printJobId, status: "OFFERED" },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (accepted.count !== 1) throw new PrintMissionError("Someone already picked this mission 🫡");
    await tx.runnerAssignment.updateMany({
      where: { printJobId, id: { not: assignment!.id }, status: "OFFERED" },
      data: { status: "EXPIRED" },
    });
    await writeAuditLog(tx, {
      actorId: userId,
      action: "PRINT_MISSION_ACCEPTED",
      resource: "PrintJob",
      resourceId: printJobId,
      previousState: { status: "FINDING_RUNNER" },
      newState: { status: "RUNNER_ASSIGNED", assignedRunnerId: runner.id },
    });
    return { accepted: true, alreadyAccepted: false, status: "RUNNER_ASSIGNED" as const };
  }, "Someone already picked this mission 🫡");
}

/** Loads a print job only when it is assigned to this runner through an accepted assignment. */
async function assignedPrintJob(tx: Tx, userId: string, printJobId: string) {
  const runner = await activeRunner(tx, userId);
  const assignment = await tx.runnerAssignment.findUnique({
    where: { printJobId_runnerId: { printJobId, runnerId: runner.id } },
    select: { id: true, status: true, runnerId: true },
  });
  const job = await tx.printJob.findFirst({
    where: { id: printJobId, assignedRunnerId: runner.id },
    select: { id: true, status: true, userId: true, assignedRunnerId: true },
  });
  if (!assignment || !job || !["ACCEPTED", "COMPLETED"].includes(assignment.status)) {
    throw new PrintMissionError("This print job is not assigned to you.", 404);
  }
  return { runner, assignment, job };
}

export async function advancePrintMission(userId: string, printJobId: string, action: PrintMissionStepAction) {
  return serializable(async (tx) => {
    const { runner, assignment, job } = await assignedPrintJob(tx, userId, printJobId);
    const plan = planPrintMissionStep(job.status, action);
    if (plan.kind === "already-done") return { status: plan.status, alreadyDone: true };
    if (plan.kind === "rejected") throw new PrintMissionError(plan.message, plan.status);
    if (assignment.status !== "ACCEPTED") throw new PrintMissionError("This print assignment is no longer active.");

    await transitionPrintJobInTransaction(tx, {
      printJobId,
      toStatus: plan.to,
      actorId: userId,
      note: plan.note,
      guard: { assignedRunnerId: runner.id },
    });
    if (plan.to === "DELIVERED") {
      const completed = await tx.runnerAssignment.updateMany({
        where: { id: assignment.id, status: "ACCEPTED" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (completed.count !== 1) throw new PrintMissionError("This print assignment is no longer active.");
      await tx.runnerProfile.update({
        where: { id: runner.id },
        data: { totalDeliveries: { increment: 1 }, completedDeliveries: { increment: 1 } },
      });
    }
    return { status: plan.to, alreadyDone: false };
  }, "This print job changed. Refresh and try again.");
}

export async function reportPrintMissionIssue(
  userId: string,
  printJobId: string,
  issue: PrintMissionIssueAction | "delivery-issue",
  rawNote: unknown,
) {
  const note = sanitizeIssueNote(rawNote);
  return serializable(async (tx) => {
    const { assignment, job } = await assignedPrintJob(tx, userId, printJobId);
    if (assignment.status !== "ACCEPTED") throw new PrintMissionError("This print assignment is no longer active.");
    const reference = printMissionReference(printJobId);

    if (issue === "delivery-issue") {
      if (job.status !== "OUT_FOR_DELIVERY") {
        throw new PrintMissionError("Delivery issues can only be reported while the print job is out for delivery.");
      }
      const audit = await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "PRINT_DELIVERY_ISSUE",
          resource: "PrintJob",
          resourceId: printJobId,
          newState: { status: job.status },
          details: note || "Runner reported a delivery issue.",
        },
        select: { id: true },
      });
      await createNotification(tx, {
        userId: job.userId,
        type: "DELIVERY",
        title: "Delivery update",
        message: "The runner reported a delivery issue. PackAM operations is reviewing it.",
        relatedType: "PRINT_JOB",
        relatedId: printJobId,
        idempotencyKey: `print-delivery-issue:${audit.id}`,
      });
      await notifyAdmins(tx, {
        type: "DELIVERY",
        title: "Print delivery issue",
        message: `Runner reported a delivery issue for print job ${reference}.`,
        relatedType: "PRINT_JOB",
        relatedId: printJobId,
        idempotencyKey: `print-delivery-issue-admin:${audit.id}`,
      });
      return { status: job.status, reported: true };
    }

    const plan = planPrintMissionIssue(job.status, issue);
    if (plan.kind === "already-done") return { status: plan.status, reported: false };
    if (plan.kind === "rejected") throw new PrintMissionError(plan.message, plan.status);
    await transitionPrintJobInTransaction(tx, {
      printJobId,
      toStatus: plan.to,
      actorId: userId,
      note: note ? `${plan.note} ${note}` : plan.note,
      guard: { assignedRunnerId: assignment.runnerId },
    });
    await writeAuditLog(tx, {
      actorId: userId,
      action: issue === "document-unreadable" ? "PRINT_DOCUMENT_UNREADABLE" : "PRINT_FAILED",
      resource: "PrintJob",
      resourceId: printJobId,
      previousState: { status: plan.from },
      newState: { status: plan.to },
      details: note || undefined,
    });
    await notifyAdmins(tx, {
      type: "ORDER",
      title: issue === "document-unreadable" ? "Print document unreadable" : "Print job failed",
      message: `Runner reported ${issue === "document-unreadable" ? "an unreadable document" : "a printing failure"} for print job ${reference}. Retry or start a refund.`,
      relatedType: "PRINT_JOB",
      relatedId: printJobId,
      idempotencyKey: `print-issue:${printJobId}:${plan.to}:${Date.now()}`,
    });
    return { status: plan.to, reported: true };
  }, "This print job changed. Refresh and try again.");
}

/**
 * Authorizes the assigned runner and returns a short-lived private URL for server-side use only.
 * The caller must stream the bytes and never send the URL to the browser or a log.
 */
export async function authorizePrintDocumentAccess(userId: string, printJobId: string) {
  return db.$transaction(async (tx) => {
    const runner = await activeRunner(tx, userId);
    const [assignment, job] = await Promise.all([
      tx.runnerAssignment.findUnique({
        where: { printJobId_runnerId: { printJobId, runnerId: runner.id } },
        select: { runnerId: true, status: true },
      }),
      tx.printJob.findUnique({
        where: { id: printJobId },
        select: {
          status: true,
          assignedRunnerId: true,
          document: { select: { publicId: true, originalFileName: true, deletedAt: true } },
        },
      }),
    ]);
    if (!job || !runnerMayAccessPrintDocument({ runnerId: runner.id, assignment, job, document: job.document })) {
      throw new PrintMissionError("This document is not available to you.", 404);
    }
    await writeAuditLog(tx, {
      actorId: userId,
      action: "PRINT_DOCUMENT_ACCESSED",
      resource: "PrintJob",
      resourceId: printJobId,
      newState: { status: job.status },
    });
    return {
      fileName: job.document!.originalFileName,
      url: createPrivatePrintDocumentDownloadUrl(job.document!.publicId),
    };
  });
}

const missionJobSelect = {
  id: true,
  status: true,
  paperSize: true,
  colorMode: true,
  sides: true,
  copies: true,
  pageSelection: true,
  selectedPageCount: true,
  instructions: true,
  checkoutSnapshot: true,
  document: { select: { originalFileName: true, pageCount: true, deletedAt: true } },
} satisfies Prisma.PrintJobSelect;

const ACTIVE_PRINT_STATUSES = [
  "FINDING_RUNNER",
  "RUNNER_ASSIGNED",
  "DOCUMENT_RECEIVED",
  "PRINTING",
  "PRINTED",
  "OUT_FOR_DELIVERY",
  "DOCUMENT_UNREADABLE",
  "PRINT_FAILED",
] as const;

export async function listRunnerPrintMissions(runnerId: string) {
  const assignments = await db.runnerAssignment.findMany({
    where: {
      runnerId,
      printJobId: { not: null },
      OR: [
        { status: "OFFERED", offeredAt: { gte: offerCutoff(new Date(), getRunnerAcceptanceTimeoutMinutes()) }, printJob: { status: "FINDING_RUNNER", assignedRunnerId: null } },
        { status: "ACCEPTED", printJob: { status: { in: [...ACTIVE_PRINT_STATUSES] }, assignedRunnerId: runnerId } },
      ],
    },
    orderBy: { offeredAt: "desc" },
    take: 50,
    select: { id: true, status: true, printJob: { select: missionJobSelect } },
  });
  return assignments.flatMap(({ id, status, printJob }) =>
    printJob ? [{ assignmentId: id, ...toRunnerPrintMissionView({ assignmentStatus: status, job: printJob }) }] : []);
}

export async function listActivePrintMissionsForAdmin() {
  const assignments = await db.runnerAssignment.findMany({
    where: { printJobId: { not: null }, status: { in: ["OFFERED", "ACCEPTED"] }, printJob: { status: { in: [...ACTIVE_PRINT_STATUSES] } } },
    orderBy: { offeredAt: "desc" },
    take: 100,
    select: { id: true, status: true, printJob: { select: missionJobSelect } },
  });
  return assignments.flatMap(({ id, status, printJob }) =>
    printJob ? [{ assignmentId: id, ...toRunnerPrintMissionView({ assignmentStatus: status === "ACCEPTED" ? "ADMIN_ASSIGNED" : status, job: printJob }) }] : []);
}

export async function getRunnerPrintMission(userId: string, printJobId: string) {
  const runner = await db.runnerProfile.findFirst({
    where: { userId, isVerified: true, user: { role: "RUNNER", status: "ACTIVE" } },
    select: { id: true },
  });
  if (!runner) throw new PrintMissionError("Your runner profile is not active and verified.", 403);
  const assignment = await db.runnerAssignment.findUnique({
    where: { printJobId_runnerId: { printJobId, runnerId: runner.id } },
    select: {
      status: true,
      printJob: { select: { ...missionJobSelect, assignedRunnerId: true, user: { select: { firstName: true, phone: true } } } },
    },
  });
  const job = assignment?.printJob;
  const visible = assignment && job && (
    (assignment.status === "OFFERED" && job.status === "FINDING_RUNNER" && !job.assignedRunnerId) ||
    (["ACCEPTED", "COMPLETED"].includes(assignment.status) && job.assignedRunnerId === runner.id)
  );
  if (!visible) throw new PrintMissionError("Mission not found.", 404);
  return toRunnerPrintMissionView({ assignmentStatus: assignment.status, job });
}
