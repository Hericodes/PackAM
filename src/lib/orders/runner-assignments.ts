import "server-only";

import { Prisma } from "@prisma/client";
import { getRunnerAcceptanceTimeoutMinutes } from "./price-policy";
import {
  buildMarketplaceMissionOffers,
  buildPrintMissionOffers,
  canOfferFindingOrder,
  canOfferFindingPrintJob,
  eligibleAvailableRunnerWhere,
  runnersWithoutExistingOffers,
} from "./runner-offer-policy";

type Tx = Prisma.TransactionClient;

async function eligibleAvailableRunners(tx: Tx) {
  return tx.runnerProfile.findMany({
    where: eligibleAvailableRunnerWhere,
    select: { id: true, userId: true },
  });
}

export async function offerFindingOrderToAvailableRunners(tx: Tx, orderId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, assignedRunnerId: true },
  });
  if (!order || !canOfferFindingOrder(order)) return 0;

  const runners = await eligibleAvailableRunners(tx);
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

/** Jobs past the acceptance window can no longer be accepted, so they are not offered. */
function acceptanceCutoff() {
  return new Date(Date.now() - getRunnerAcceptanceTimeoutMinutes() * 60_000);
}

/**
 * Offers waiting orders to a runner who just became available. Uses one lookup and a skipDuplicates
 * insert: a failed statement would abort the surrounding Postgres transaction, so nothing here may
 * rely on catching a unique-constraint error and carrying on.
 */
export async function offerFindingOrdersToRunner(tx: Tx, runnerProfileId: string) {
  const runner = await tx.runnerProfile.findUnique({ where: { id: runnerProfileId }, select: { userId: true } });
  if (!runner) return 0;
  const orders = await tx.order.findMany({
    where: {
      status: "FINDING_RUNNER",
      assignedRunnerId: null,
      findingRunnerAt: { gte: acceptanceCutoff() },
      assignments: { none: { runnerId: runnerProfileId } },
    },
    select: { id: true },
    orderBy: { findingRunnerAt: "asc" },
    take: 50,
  });
  if (!orders.length) return 0;
  const offers = orders.map((order) => buildMarketplaceMissionOffers(order.id, [{ id: runnerProfileId, userId: runner.userId }]));
  const created = await tx.runnerAssignment.createMany({ data: offers.map((offer) => offer.assignments[0]), skipDuplicates: true });
  await tx.notification.createMany({
    data: offers.map((offer) => ({ ...offer.notifications[0], title: "New mission available 🫡", message: "Someone needs their stuff." })),
    skipDuplicates: true,
  });
  return created.count;
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
      findingRunnerAt: { gte: acceptanceCutoff() },
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
