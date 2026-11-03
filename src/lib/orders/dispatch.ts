import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { claimUrgentEscalationInTransaction, inTierSavepoint, loadOrderDeliveryTiers, orderDeliveryTierInTransaction, readTierTables } from "../delivery-tier-store";
import {
  DELIVERY_TIER_LABELS,
  ESCALATION_MINUTES,
  URGENT_ESCALATION_TITLE,
  URGENT_TIERS,
  idleRunnerRuleApplies,
  isUrgentTier,
  urgentEscalationDue,
  urgentEscalationMessage,
  urgentSafeDeadlineMinutes,
  type UrgentDeliveryTier,
} from "../delivery-tiers";
import { notifyAdmins } from "../notifications";
import { shortReference } from "../student-copy";
import { getRunnerAcceptanceTimeoutMinutes } from "./price-policy";
import { getDispatchDeadlineMinutes, offerCutoff, planDispatch, type DispatchOutcome } from "./dispatch-policy";
import { buildMarketplaceMissionOffers, buildPrintMissionOffers, eligibleAvailableRunnerWhere, idleEligibleAvailableRunnerWhere } from "./runner-offer-policy";
import { startRefundWorkflow } from "./refunds";
import { startPrintRefundProcessing } from "../printing/fulfilment-recovery";

type Tx = Prisma.TransactionClient;
/** `escalated`: this step alerted admins that an Oya Now!/Sharp Sharp order wasn't accepted in time (once per order). */
export type DispatchResult = { outcome: DispatchOutcome; offered: number; expiredOffers: number; escalated: boolean };

/** Most missions handled per scheduled run, so one invocation stays well inside function time limits. */
export const DISPATCH_BATCH_LIMIT = 25;

/** The same alert when a runner accepted the order after its threshold, before any dispatch step escalated it. */
export function urgentAcceptedLateMessage(tier: UrgentDeliveryTier, orderReference: string) {
  return `${DELIVERY_TIER_LABELS[tier]} order ${orderReference} wasn’t accepted within ${ESCALATION_MINUTES[tier]} minutes. A runner has accepted it late. Check it still arrives on time.`;
}

/**
 * Claims an urgent order's escalation and alerts every active admin, in the caller's transaction, with the one key
 * `urgent-unaccepted:{orderId}`. True for exactly one caller however many race. The claim (escalatedAt) is kept only
 * when an alert was written: with no active admin it is released, so a later step claims it again and alerts then.
 */
export async function escalateUrgentOrderInTransaction(tx: Tx, input: { orderId: string; message: string; now: Date }): Promise<boolean> {
  if (!(await claimUrgentEscalationInTransaction(tx, input.orderId, input.now))) return false;
  const alerted = await notifyAdmins(tx, { type: "DELIVERY", title: URGENT_ESCALATION_TITLE, message: input.message, orderId: input.orderId, idempotencyKey: `urgent-unaccepted:${input.orderId}` });
  if (alerted > 0) return true;
  await inTierSavepoint(tx, (savepoint) => savepoint.orderDeliveryTier.updateMany({ where: { orderId: input.orderId, escalatedAt: { not: null } }, data: { escalatedAt: null } }), null, "escalation release");
  return false;
}

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
 *
 * Delivery tiers: an Oya Now!/Sharp Sharp order goes only to runners with no accepted mission until it escalates
 * (ESCALATION_MINUTES after it started looking for a runner). The first step after that claims the escalation
 * (OrderDeliveryTier.escalatedAt, set once by a guarded update) and alerts admins in the same transaction, then
 * offers it to every untried eligible runner. Orders without a tier row dispatch exactly as before.
 */
export async function dispatchOrderInTransaction(tx: Tx, orderId: string, now = new Date()): Promise<DispatchResult> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, assignedRunnerId: true, findingRunnerAt: true } });
  if (!order) return { outcome: "NOT_DISPATCHABLE", offered: 0, expiredOffers: 0, escalated: false };
  // Its delivery tier, read in its own savepoint (never alongside other work on this transaction).
  const tier = await orderDeliveryTierInTransaction(tx, orderId);
  const startedAt = order.findingRunnerAt ?? tier?.createdAt ?? now;
  let escalatedAt = tier?.escalatedAt ?? null;
  let escalated = false;
  if (tier && isUrgentTier(tier.tier) && urgentEscalationDue({ tier: tier.tier, startedAt, escalatedAt, status: order.status, assignedRunnerId: order.assignedRunnerId, now })) {
    // True for exactly one transaction however many passes race; the notification key makes the alert once-only too.
    escalated = await escalateUrgentOrderInTransaction(tx, { orderId, message: urgentEscalationMessage(tier.tier, shortReference(orderId)), now });
    if (escalated) escalatedAt = now;
  }
  const idleOnly = idleRunnerRuleApplies({ tier: tier?.tier, startedAt, escalatedAt, now });
  const [offers, runners] = await Promise.all([
    tx.runnerAssignment.findMany({ where: { orderId }, select: { id: true, runnerId: true, status: true, offeredAt: true } }),
    // Busy runners left out here stay untried, so the first step after escalation offers it to them.
    idleOnly ? tx.runnerProfile.findMany({ where: idleEligibleAvailableRunnerWhere, select: { id: true, userId: true } }) : eligibleRunners(tx),
  ]);
  const { offerWindowMinutes, deadlineMinutes } = windows();
  const plan = planDispatch({
    mission: order, offers, eligibleRunnerIds: runners.map((runner) => runner.id), now, offerWindowMinutes,
    // An urgent order never reaches refund review while it is still held back for runners with no missions.
    deadlineMinutes: urgentSafeDeadlineMinutes(tier?.tier, deadlineMinutes),
  });

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
  return { outcome: plan.outcome, offered, expiredOffers, escalated };
}

/** The same step for a paid print job. Print jobs have no delivery tier: they dispatch with Cruise Mode's rules. */
export async function dispatchPrintJobInTransaction(tx: Tx, printJobId: string, now = new Date()): Promise<DispatchResult> {
  const job = await tx.printJob.findUnique({ where: { id: printJobId }, select: { id: true, status: true, assignedRunnerId: true, findingRunnerAt: true } });
  if (!job) return { outcome: "NOT_DISPATCHABLE", offered: 0, expiredOffers: 0, escalated: false };
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
  return { outcome: plan.outcome, offered, expiredOffers, escalated: false };
}

function runSerializable<T>(work: (tx: Tx) => Promise<T>) {
  return retrySerializable(() => db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 6, baseDelayMs: 25 });
}

export type DispatchCycleSummary = { scanned: number; offered: number; expiredOffers: number; waiting: number; refundReviews: number; escalations: number; failed: number };

function emptySummary(): DispatchCycleSummary {
  return { scanned: 0, offered: 0, expiredOffers: 0, waiting: 0, refundReviews: 0, escalations: 0, failed: 0 };
}

function tally(summary: DispatchCycleSummary, result: DispatchResult) {
  summary.offered += result.offered;
  summary.expiredOffers += result.expiredOffers;
  if (result.outcome === "WAITING_ON_OFFERS" || result.outcome === "WAITING_FOR_RUNNERS") summary.waiting += 1;
  if (result.outcome === "REFUND_REVIEW") summary.refundReviews += 1;
  if (result.escalated) summary.escalations += 1;
}

/**
 * Orders waiting for a runner: urgent orders due for escalation, then Oya Now!, then Sharp Sharp (oldest first), then
 * everything else oldest first. At least a quarter of the batch is kept for that last group, so a stream of urgent
 * orders never starves Cruise Mode and older orders of expiry, redispatch and refund review. Escalation-due orders
 * are always included (so with very many of them the batch can grow by that quarter).
 */
export async function selectDispatchCandidates(limit = DISPATCH_BATCH_LIMIT, now = new Date()): Promise<string[]> {
  const reserved = Math.ceil(limit / 4);
  const waiting = { status: "FINDING_RUNNER" as const, assignedRunnerId: null };
  // Two queries, never one relation orderBy across all orders: orders without a tier row would sort after Cruise Mode.
  const { due, urgent } = await readTierTables(db, async (client) => ({
    // Mirrors urgentEscalationDue: started (findingRunnerAt, else the row's createdAt) at least ESCALATION_MINUTES ago.
    due: await client.orderDeliveryTier.findMany({
      where: {
        escalatedAt: null,
        order: { is: waiting },
        OR: URGENT_TIERS.map((tier) => {
          const startedBy = new Date(now.getTime() - ESCALATION_MINUTES[tier] * 60_000);
          return { tier, OR: [{ order: { is: { findingRunnerAt: { lte: startedBy } } } }, { createdAt: { lte: startedBy }, order: { is: { findingRunnerAt: null } } }] };
        }),
      },
      orderBy: [{ tier: "asc" }, { createdAt: "asc" }],
      take: limit,
      select: { orderId: true },
    }),
    urgent: await client.orderDeliveryTier.findMany({
      where: { tier: { in: [...URGENT_TIERS] }, order: { is: waiting } },
      orderBy: [{ tier: "asc" }, { createdAt: "asc" }],
      take: limit,
      select: { orderId: true },
    }),
  }), { due: [] as Array<{ orderId: string }>, urgent: [] as Array<{ orderId: string }> }, "dispatch scan");
  const dueIds = due.map((row) => row.orderId);
  const scannedUrgent = [...new Set([...dueIds, ...urgent.map((row) => row.orderId)])];
  const urgentIds = scannedUrgent.slice(0, Math.max(dueIds.length, limit - reserved));
  const restTake = Math.max(reserved, limit - urgentIds.length);
  // More urgent orders than one scan: the extras would show up below and take the reserved places.
  const overflow = urgent.length >= limit;
  // Without the tier tables this is exactly the scan from before delivery tiers.
  const rest = await db.order.findMany({
    where: { ...waiting, ...(scannedUrgent.length ? { id: { notIn: scannedUrgent } } : {}) },
    select: { id: true },
    orderBy: { findingRunnerAt: "asc" },
    take: overflow ? restTake + limit : restTake,
  });
  let restIds = rest.map((order) => order.id);
  if (overflow) {
    const tiers = await loadOrderDeliveryTiers(db, restIds);
    restIds = restIds.filter((orderId) => !isUrgentTier(tiers.get(orderId)?.tier));
  }
  return [...urgentIds, ...restIds.slice(0, restTake)];
}

/**
 * Scheduled pass over orders still looking for a runner: expire stale offers, redispatch, and only then
 * move missions that genuinely can't progress to refund review. Bounded per run; each mission is its own
 * retried serializable transaction, so a failure on one never blocks the rest and re-running is safe.
 * Escalation-due, Oya Now! and Sharp Sharp orders are handled first, with a quarter of the batch kept for the rest.
 */
export async function dispatchDueOrders(now = new Date(), limit = DISPATCH_BATCH_LIMIT): Promise<DispatchCycleSummary> {
  const summary = emptySummary();
  const candidates = await selectDispatchCandidates(limit, now);
  summary.scanned = candidates.length;
  for (const orderId of candidates) {
    try {
      tally(summary, await runSerializable((tx) => dispatchOrderInTransaction(tx, orderId, now)));
    } catch (error) {
      summary.failed += 1;
      console.error("ORDER DISPATCH ERROR:", orderId.slice(-6), error instanceof Error ? error.name : "Unknown error");
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
