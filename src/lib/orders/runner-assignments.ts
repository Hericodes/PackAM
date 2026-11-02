import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { deliveryTierTablesReady, inTierSavepoint, orderDeliveryTierInTransaction } from "../delivery-tier-store";
import { URGENT_TIERS, idleRunnerRuleApplies } from "../delivery-tiers";
import {
  buildMarketplaceMissionOffers,
  buildPrintMissionOffers,
  canOfferFindingOrder,
  canOfferFindingPrintJob,
  eligibleAvailableRunnerWhere,
  idleEligibleAvailableRunnerWhere,
  runnersWithoutExistingOffers,
} from "./runner-offer-policy";

type Tx = Prisma.TransactionClient;

async function eligibleAvailableRunners(tx: Tx) {
  return tx.runnerProfile.findMany({
    where: eligibleAvailableRunnerWhere,
    select: { id: true, userId: true },
  });
}

/**
 * Payment-time offers. completeVerifiedPayment writes the order's delivery tier row first, in the same transaction,
 * so an Oya Now!/Sharp Sharp order is offered only to runners with no accepted mission until it escalates.
 */
export async function offerFindingOrderToAvailableRunners(tx: Tx, orderId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, assignedRunnerId: true, findingRunnerAt: true },
  });
  if (!order || !canOfferFindingOrder(order)) return 0;

  // Read in its own savepoint, never alongside other work on this transaction.
  const tier = await orderDeliveryTierInTransaction(tx, orderId);
  const now = new Date();
  const idleOnly = idleRunnerRuleApplies({ tier: tier?.tier, startedAt: order.findingRunnerAt ?? tier?.createdAt ?? now, escalatedAt: tier?.escalatedAt ?? null, now });
  const runners = idleOnly
    ? await tx.runnerProfile.findMany({ where: idleEligibleAvailableRunnerWhere, select: { id: true, userId: true } })
    : await eligibleAvailableRunners(tx);
  if (runners.length === 0) return 0;

  const existing = await tx.runnerAssignment.findMany({
    where: { orderId, runnerId: { in: runners.map((runner) => runner.id) } },
    select: { runnerId: true },
  });
  const newRunners = runnersWithoutExistingOffers(
    runners,
    existing.map((assignment) => assignment.runnerId),
  );
  if (!newRunners.length) return 0;

  const offers = buildMarketplaceMissionOffers(orderId, newRunners);
  await tx.runnerAssignment.createMany({
    data: offers.assignments,
    skipDuplicates: true,
  });
  await tx.notification.createMany({
    data: offers.notifications,
    skipDuplicates: true,
  });
  return newRunners.length;
}

/**
 * Offers waiting orders to a runner who just became available. Uses one lookup and a skipDuplicates
 * insert: a failed statement would abort the surrounding Postgres transaction, so nothing here may
 * rely on catching a unique-constraint error and carrying on.
 *
 * Oya Now! and Sharp Sharp orders come first; while their idle-runner rule applies they are offered only when this
 * runner has no accepted mission (order or print job), and the order query below never offers them either.
 */
export async function offerFindingOrdersToRunner(tx: Tx, runnerProfileId: string, now = new Date()) {
  const runner = await tx.runnerProfile.findUnique({ where: { id: runnerProfileId }, select: { userId: true } });
  if (!runner) return 0;
  const activeMissions = await tx.runnerAssignment.count({ where: { runnerId: runnerProfileId, status: "ACCEPTED" } });
  // In its own savepoint (never alongside other work on this transaction); no rows without the tier tables.
  const urgent = await inTierSavepoint(tx, (savepoint) => savepoint.orderDeliveryTier.findMany({
    where: {
      tier: { in: [...URGENT_TIERS] },
      order: { is: { status: "FINDING_RUNNER", assignedRunnerId: null, assignments: { none: { runnerId: runnerProfileId } } } },
    },
    orderBy: [{ tier: "asc" }, { createdAt: "asc" }],
    take: 50,
    select: { orderId: true, tier: true, escalatedAt: true, createdAt: true, order: { select: { findingRunnerAt: true } } },
  }), [], "runner offers");
  const urgentIds = urgent.map((row) => row.orderId);
  const orders = await tx.order.findMany({
    where: {
      status: "FINDING_RUNNER",
      assignedRunnerId: null,
      assignments: { none: { runnerId: runnerProfileId } },
      ...(urgentIds.length ? { id: { notIn: urgentIds } } : {}),
    },
    select: { id: true },
    orderBy: { findingRunnerAt: "asc" },
    take: 50,
  });
  // More than 50 urgent orders waiting could let an extra one through to a busy runner; acceptance still refuses it.
  const offerable = [
    ...urgent
      .filter((row) => activeMissions === 0 || !idleRunnerRuleApplies({ tier: row.tier, startedAt: row.order.findingRunnerAt ?? row.createdAt, escalatedAt: row.escalatedAt, now }))
      .map((row) => row.orderId),
    ...orders.map((order) => order.id),
  ];
  if (!offerable.length) return 0;
  const offers = offerable.map((orderId) => buildMarketplaceMissionOffers(orderId, [{ id: runnerProfileId, userId: runner.userId }]));
  const created = await tx.runnerAssignment.createMany({ data: offers.map((offer) => offer.assignments[0]), skipDuplicates: true });
  await tx.notification.createMany({
    data: offers.map((offer) => ({ ...offer.notifications[0], title: "New mission available 🫡", message: "Someone needs their stuff." })),
    skipDuplicates: true,
  });
  return created.count;
}

/**
 * A runner who just finished their last mission is idle again: offer them waiting missions they haven't been offered
 * (urgent orders held back for idle runners included) without waiting for the next scheduled pass. Runs after the
 * delivery committed; never fails or delays it.
 */
export async function offerWaitingOrdersToIdleRunner(runnerProfileId: string) {
  try {
    // Without the tier tables nothing is held back for idle runners: keep today's behaviour (the next pass offers the rest).
    if (!(await deliveryTierTablesReady(db))) return 0;
    return await retrySerializable(() => db.$transaction(async (tx) => {
      const runner = await tx.runnerProfile.findFirst({ where: { id: runnerProfileId, ...eligibleAvailableRunnerWhere }, select: { id: true } });
      if (!runner || await tx.runnerAssignment.count({ where: { runnerId: runner.id, status: "ACCEPTED" } })) return 0;
      return offerFindingOrdersToRunner(tx, runner.id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 3, baseDelayMs: 25 });
  } catch (error) {
    console.error("IDLE RUNNER OFFER ERROR:", error instanceof Error ? error.name : "Unknown error");
    return 0;
  }
}

export async function offerFindingPrintJobToAvailableRunners(tx: Tx, printJobId: string) {
  const job = await tx.printJob.findUnique({
    where: { id: printJobId },
    select: { id: true, status: true, assignedRunnerId: true },
  });
  if (!job || !canOfferFindingPrintJob(job)) return 0;

  const runners = await eligibleAvailableRunners(tx);
  if (runners.length === 0) return 0;

  const existing = await tx.runnerAssignment.findMany({
    where: { printJobId, runnerId: { in: runners.map((runner) => runner.id) } },
    select: { runnerId: true },
  });
  const newRunners = runnersWithoutExistingOffers(
    runners,
    existing.map((assignment) => assignment.runnerId),
  );
  if (!newRunners.length) return 0;

  const offers = buildPrintMissionOffers(printJobId, newRunners);
  await tx.runnerAssignment.createMany({
    data: offers.assignments,
    skipDuplicates: true,
  });
  await tx.notification.createMany({
    data: offers.notifications,
    skipDuplicates: true,
  });
  return newRunners.length;
}

export async function offerFindingPrintJobsToRunner(tx: Tx, runnerProfileId: string) {
  const runner = await tx.runnerProfile.findUnique({ where: { id: runnerProfileId }, select: { userId: true } });
  if (!runner) return 0;
  const jobs = await tx.printJob.findMany({
    where: {
      status: "FINDING_RUNNER",
      assignedRunnerId: null,
      assignments: { none: { runnerId: runnerProfileId } },
    },
    select: { id: true },
    orderBy: { findingRunnerAt: "asc" },
    take: 50,
  });
  if (!jobs.length) return 0;
  const offers = jobs.map((job) => buildPrintMissionOffers(job.id, [{ id: runnerProfileId, userId: runner.userId }]));
  const created = await tx.runnerAssignment.createMany({ data: offers.map((offer) => offer.assignments[0]), skipDuplicates: true });
  await tx.notification.createMany({
    data: offers.map((offer) => ({ ...offer.notifications[0], title: "New print mission available 🫡", message: "A paid print job is waiting." })),
    skipDuplicates: true,
  });
  return created.count;
}
