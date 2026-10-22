import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { notifyAdmins } from "../notifications";
import { getRunnerAcceptanceTimeoutMinutes } from "./price-policy";
import { getDispatchDeadlineMinutes, offerCutoff, planDispatch, type DispatchOutcome } from "./dispatch-policy";
import { buildMarketplaceMissionOffers, buildPrintMissionOffers, eligibleAvailableRunnerWhere } from "./runner-offer-policy";
import { startRefundWorkflow } from "./refunds";
import { startPrintRefundProcessing } from "../printing/fulfilment-recovery";

type Tx = Prisma.TransactionClient;
export type DispatchResult = { outcome: DispatchOutcome; offered: number; expiredOffers: number };

/** Most missions handled per scheduled run, so one invocation stays well inside function time limits. */
export const DISPATCH_BATCH_LIMIT = 25;

function windows() {
  const offerWindowMinutes = getRunnerAcceptanceTimeoutMinutes();
  return { offerWindowMinutes, deadlineMinutes: getDispatchDeadlineMinutes(offerWindowMinutes) };
}

function eligibleRunners(tx: Tx) {
  return tx.runnerProfile.findMany({ where: eligibleAvailableRunnerWhere, select: { id: true, userId: true } });
}

/**
 * One dispatch step for a paid order. Call inside a serializable transaction: the (order, runner) unique
 * key plus skipDuplicates make duplicate offers impossible, and every write is guarded by current state.
 */
export async function dispatchOrderInTransaction(tx: Tx, orderId: string, now = new Date()): Promise<DispatchResult> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, assignedRunnerId: true, findingRunnerAt: true } });
  if (!order) return { outcome: "NOT_DISPATCHABLE", offered: 0, expiredOffers: 0 };
  const [offers, runners] = await Promise.all([
    tx.runnerAssignment.findMany({ where: { orderId }, select: { id: true, runnerId: true, status: true, offeredAt: true } }),
    eligibleRunners(tx),
  ]);
  const { offerWindowMinutes, deadlineMinutes } = windows();
  const plan = planDispatch({ mission: order, offers, eligibleRunnerIds: runners.map((runner) => runner.id), now, offerWindowMinutes, deadlineMinutes });

  let expiredOffers = 0;
  if (plan.expireOfferIds.length) {
    expiredOffers = (await tx.runnerAssignment.updateMany({
      where: { id: { in: plan.expireOfferIds }, status: "OFFERED", offeredAt: { lt: offerCutoff(now, offerWindowMinutes) } },
      data: { status: "EXPIRED" },
    })).count;
  }
  let offered = 0;
  if (plan.outcome === "OFFERED") {
    const wanted = new Set(plan.offerRunnerIds);
    const batch = buildMarketplaceMissionOffers(orderId, runners.filter((runner) => wanted.has(runner.id)));
    offered = (await tx.runnerAssignment.createMany({ data: batch.assignments, skipDuplicates: true })).count;
    await tx.notification.createMany({ data: batch.notifications, skipDuplicates: true });
  }
  if (plan.outcome === "REFUND_REVIEW") {
    // Starts the refund workflow (refund PENDING) for operations; it does not return any money itself.
    await startRefundWorkflow(tx, { orderId, reason: "NO_RUNNER", note: "No eligible runner accepted this mission before the dispatch deadline." });
    await notifyAdmins(tx, { type: "DELIVERY", title: "No runner accepted order", message: `Order ${orderId} found no runner before its dispatch deadline and moved to refund review. Complete any refund in the payment provider dashboard.`, orderId, idempotencyKey: `no-runner:${orderId}` });
  }
  return { outcome: plan.outcome, offered, expiredOffers };
}

/** The same step for a paid print job. */
export async function dispatchPrintJobInTransaction(tx: Tx, printJobId: string, now = new Date()): Promise<DispatchResult> {
  const job = await tx.printJob.findUnique({ where: { id: printJobId }, select: { id: true, status: true, assignedRunnerId: true, findingRunnerAt: true } });
  if (!job) return { outcome: "NOT_DISPATCHABLE", offered: 0, expiredOffers: 0 };
  const [offers, runners] = await Promise.all([
    tx.runnerAssignment.findMany({ where: { printJobId }, select: { id: true, runnerId: true, status: true, offeredAt: true } }),
    eligibleRunners(tx),
  ]);
  const { offerWindowMinutes, deadlineMinutes } = windows();
  const plan = planDispatch({ mission: job, offers, eligibleRunnerIds: runners.map((runner) => runner.id), now, offerWindowMinutes, deadlineMinutes });

  let expiredOffers = 0;
  if (plan.expireOfferIds.length) {
    expiredOffers = (await tx.runnerAssignment.updateMany({
      where: { id: { in: plan.expireOfferIds }, status: "OFFERED", offeredAt: { lt: offerCutoff(now, offerWindowMinutes) } },
      data: { status: "EXPIRED" },
    })).count;
  }
  let offered = 0;
  if (plan.outcome === "OFFERED") {
    const wanted = new Set(plan.offerRunnerIds);
    const batch = buildPrintMissionOffers(printJobId, runners.filter((runner) => wanted.has(runner.id)));
    offered = (await tx.runnerAssignment.createMany({ data: batch.assignments, skipDuplicates: true })).count;
    await tx.notification.createMany({ data: batch.notifications, skipDuplicates: true });
  }
  if (plan.outcome === "REFUND_REVIEW") {
    await startPrintRefundProcessing(tx, { printJobId, reason: "NO_RUNNER", note: "No eligible runner accepted this print mission before the dispatch deadline." });
  }
  return { outcome: plan.outcome, offered, expiredOffers };
}

function runSerializable<T>(work: (tx: Tx) => Promise<T>) {
  return retrySerializable(() => db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 6, baseDelayMs: 25 });
}

export type DispatchCycleSummary = { scanned: number; offered: number; expiredOffers: number; waiting: number; refundReviews: number; failed: number };

function emptySummary(): DispatchCycleSummary {
  return { scanned: 0, offered: 0, expiredOffers: 0, waiting: 0, refundReviews: 0, failed: 0 };
}

function tally(summary: DispatchCycleSummary, result: DispatchResult) {
  summary.offered += result.offered;
  summary.expiredOffers += result.expiredOffers;
  if (result.outcome === "WAITING_ON_OFFERS" || result.outcome === "WAITING_FOR_RUNNERS") summary.waiting += 1;
  if (result.outcome === "REFUND_REVIEW") summary.refundReviews += 1;
}

/**
 * Scheduled pass over orders still looking for a runner: expire stale offers, redispatch, and only then
 * move missions that genuinely can't progress to refund review. Bounded per run; each mission is its own
 * retried serializable transaction, so a failure on one never blocks the rest and re-running is safe.
 */
export async function dispatchDueOrders(now = new Date(), limit = DISPATCH_BATCH_LIMIT): Promise<DispatchCycleSummary> {
  const summary = emptySummary();
  const candidates = await db.order.findMany({ where: { status: "FINDING_RUNNER", assignedRunnerId: null }, select: { id: true }, orderBy: { findingRunnerAt: "asc" }, take: limit });
  summary.scanned = candidates.length;
  for (const candidate of candidates) {
    try {
      tally(summary, await runSerializable((tx) => dispatchOrderInTransaction(tx, candidate.id, now)));
    } catch (error) {
      summary.failed += 1;
      console.error("ORDER DISPATCH ERROR:", candidate.id.slice(-6), error instanceof Error ? error.name : "Unknown error");
    }
  }
  return summary;
}

export async function dispatchDuePrintJobs(now = new Date(), limit = DISPATCH_BATCH_LIMIT): Promise<DispatchCycleSummary> {
  const summary = emptySummary();
  const candidates = await db.printJob.findMany({ where: { status: "FINDING_RUNNER", assignedRunnerId: null }, select: { id: true }, orderBy: { findingRunnerAt: "asc" }, take: limit });
  summary.scanned = candidates.length;
  for (const candidate of candidates) {
    try {
      tally(summary, await runSerializable((tx) => dispatchPrintJobInTransaction(tx, candidate.id, now)));
    } catch (error) {
      summary.failed += 1;
      console.error("PRINT DISPATCH ERROR:", candidate.id.slice(-6), error instanceof Error ? error.name : "Unknown error");
    }
  }
  return summary;
}

/** Operations "Redispatch now" for one order or print job, using exactly the scheduled rules. */
export function redispatchOrderNow(orderId: string) {
  return runSerializable((tx) => dispatchOrderInTransaction(tx, orderId));
}

export function redispatchPrintJobNow(printJobId: string) {
  return runSerializable((tx) => dispatchPrintJobInTransaction(tx, printJobId));
}
