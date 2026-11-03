import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { deliveryTierTablesReady, inTierSavepoint, orderDeliveryTierInTransaction, runnerMissionLoadInTransaction, type RunnerMissionLoad } from "../delivery-tier-store";
import { URGENT_TIERS, idleRunnerRuleApplies, isUrgentTier } from "../delivery-tiers";
import { offerCutoff } from "./dispatch-policy";
import { getRunnerAcceptanceTimeoutMinutes } from "./price-policy";
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
  let others = orders.map((order) => order.id);
  // More than 50 urgent orders waiting: the extras land in the list above. Drop those still held back for idle runners.
  if (activeMissions > 0 && urgent.length >= 50 && others.length) {
    const ids = others;
    const heldBack = await inTierSavepoint(tx, (savepoint) => savepoint.orderDeliveryTier.findMany({
      where: { orderId: { in: ids }, tier: { in: [...URGENT_TIERS] }, escalatedAt: null },
      select: { orderId: true, tier: true, escalatedAt: true, createdAt: true, order: { select: { findingRunnerAt: true } } },
    }), [], "runner offers overflow");
    const skip = new Set(heldBack
      .filter((row) => idleRunnerRuleApplies({ tier: row.tier, startedAt: row.order.findingRunnerAt ?? row.createdAt, escalatedAt: row.escalatedAt, now }))
      .map((row) => row.orderId));
    others = others.filter((orderId) => !skip.has(orderId));
  }
  const offerable = [
    ...urgent
      .filter((row) => activeMissions === 0 || !idleRunnerRuleApplies({ tier: row.tier, startedAt: row.order.findingRunnerAt ?? row.createdAt, escalatedAt: row.escalatedAt, now }))
      .map((row) => row.orderId),
    ...others,
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

const WAITING_MISSION = { status: "FINDING_RUNNER" as const, assignedRunnerId: null };

/** This runner's offers that are no longer live (expired, or open past their window) on missions still waiting for a runner. */
function lapsedOfferWhere(runnerProfileId: string, cutoff: Date) {
  return {
    runnerId: runnerProfileId,
    AND: [
      { OR: [{ status: "EXPIRED" as const }, { status: "OFFERED" as const, offeredAt: { lt: cutoff } }] },
      { OR: [{ order: { is: WAITING_MISSION } }, { printJob: { is: WAITING_MISSION } }] },
    ],
  };
}

/**
 * Re-opens offers this runner couldn't take: since the offer was made they held an Oya Now!/Sharp Sharp mission (any
 * offer), or any mission (an urgent order, which needs a runner with none). Dispatch counts such a runner as tried,
 * so without this a mission could reach refund review while this runner is free. Only missions still
 * FINDING_RUNNER with no runner; a declined (REJECTED) offer never comes back.
 * The same row goes back to OFFERED with a fresh offeredAt: dispatch sees one live offer (never an extra runner)
 * and applies its deadline again once it lapses. Idempotent: a re-opened offer is live, so it is skipped next time.
 * Urgent orders still held back for idle runners are re-opened only once the runner has no missions at all.
 */
async function reopenBlockedOffersToRunner(tx: Tx, runner: { id: string; userId: string }, load: RunnerMissionLoad, now: Date) {
  if (load.holdsUrgent) return 0;
  const windowMinutes = getRunnerAcceptanceTimeoutMinutes();
  const where = lapsedOfferWhere(runner.id, offerCutoff(now, windowMinutes));
  const lapsed = await tx.runnerAssignment.findMany({
    where,
    select: { id: true, orderId: true, printJobId: true, offeredAt: true, order: { select: { findingRunnerAt: true } } },
    orderBy: { offeredAt: "asc" },
    take: 50,
  });
  if (!lapsed.length) return 0;
  // The missions this runner held since then. One cancelled (no completion time) ended when its mission last changed.
  const accepted = await tx.runnerAssignment.findMany({
    where: { runnerId: runner.id, acceptedAt: { not: null }, OR: [{ completedAt: null }, { completedAt: { gte: lapsed[0].offeredAt } }] },
    select: { orderId: true, status: true, completedAt: true, order: { select: { updatedAt: true } }, printJob: { select: { updatedAt: true } } },
    orderBy: { acceptedAt: "desc" },
    take: 200,
  });
  const held = accepted.map((mission) => ({
    orderId: mission.orderId,
    endedAt: mission.completedAt ?? (mission.status === "ACCEPTED" ? now : mission.order?.updatedAt ?? mission.printJob?.updatedAt ?? now),
  }));
  if (!held.length) return 0;
  const orderIds = [...new Set([...held, ...lapsed].flatMap((row) => (row.orderId ? [row.orderId] : [])))];
  // In its own savepoint. No rows without the tier tables: then nothing was ever blocked.
  const tiers = await inTierSavepoint(tx, (savepoint) => savepoint.orderDeliveryTier.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, tier: true, escalatedAt: true, createdAt: true },
  }), [], "reopen offers");
  const tierOf = new Map(tiers.map((row) => [row.orderId, row]));
  // Held at some point since the offer was made (the offer may have lapsed while they held it, or before they were done).
  const heldSince = (offeredAt: Date, urgentOnly: boolean) => held.some((mission) =>
    (!urgentOnly || (mission.orderId !== null && isUrgentTier(tierOf.get(mission.orderId)?.tier))) &&
    mission.endedAt.getTime() >= offeredAt.getTime());
  const reopen = lapsed.filter((offer) => {
    const tier = offer.orderId ? tierOf.get(offer.orderId) : undefined;
    if (!tier || !isUrgentTier(tier.tier)) return heldSince(offer.offeredAt, true);
    if (!heldSince(offer.offeredAt, false)) return false;
    return load.activeMissions === 0 || !idleRunnerRuleApplies({ tier: tier.tier, startedAt: offer.order?.findingRunnerAt ?? tier.createdAt, escalatedAt: tier.escalatedAt, now });
  });
  if (!reopen.length) return 0;
  // Guarded by the same conditions, so a mission taken or cancelled meanwhile is never re-opened.
  const reopened = await tx.runnerAssignment.updateMany({
    where: { ...where, id: { in: reopen.map((offer) => offer.id) } },
    data: { status: "OFFERED", offeredAt: now },
  });
  if (!reopened.count) return 0;
  await tx.notification.createMany({
    data: reopen.map((offer) => ({
      userId: runner.userId,
      type: "DELIVERY" as const,
      title: "Mission available again 🫡",
      message: "A mission you couldn’t take earlier is still waiting.",
      ...(offer.orderId ? { orderId: offer.orderId } : { relatedType: "PRINT_JOB", relatedId: offer.printJobId }),
      idempotencyKey: `mission-reoffer:${offer.orderId ?? offer.printJobId}:${runner.id}:${now.getTime()}`,
    })),
    skipDuplicates: true,
  });
  return reopened.count;
}

/**
 * A runner who just finished or lost a mission may now take work they couldn't before. Once they hold no Oya
 * Now!/Sharp Sharp mission: re-open the offers they received while blocked (reopenBlockedOffersToRunner), then offer
 * waiting orders (urgent ones still held back for idle runners only if they have no missions) and print jobs they
 * haven't been offered, without waiting for the next scheduled pass. Runs after the change committed; never fails
 * or delays it.
 */
export async function offerWaitingMissionsToRunner(runnerProfileId: string) {
  try {
    // Without the tier tables nothing is held back or blocked: keep today's behaviour (the next pass offers the rest).
    if (!(await deliveryTierTablesReady(db))) return 0;
    return await retrySerializable(() => db.$transaction(async (tx) => {
      const runner = await tx.runnerProfile.findFirst({ where: { id: runnerProfileId, ...eligibleAvailableRunnerWhere }, select: { id: true, userId: true } });
      if (!runner) return 0;
      const load = await runnerMissionLoadInTransaction(tx, runner.id);
      if (load.holdsUrgent) return 0;
      const now = new Date();
      const reopened = await reopenBlockedOffersToRunner(tx, runner, load, now);
      const orders = await offerFindingOrdersToRunner(tx, runner.id, now);
      const prints = await offerFindingPrintJobsToRunner(tx, runner.id);
      return reopened + orders + prints;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 3, baseDelayMs: 25 });
  } catch (error) {
    console.error("FREED RUNNER OFFER ERROR:", error instanceof Error ? error.name : "Unknown error");
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
