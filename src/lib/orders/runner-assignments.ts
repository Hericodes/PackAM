import "server-only";

import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export async function offerFindingOrderToAvailableRunners(tx: Tx, orderId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, assignedRunnerId: true },
  });
  if (!order || order.status !== "FINDING_RUNNER" || order.assignedRunnerId) return 0;

  const runners = await tx.runnerProfile.findMany({
    where: { isAvailable: true, isVerified: true, user: { role: "RUNNER", status: "ACTIVE" } },
    select: { id: true, userId: true },
  });
  if (runners.length === 0) return 0;

  const existing = await tx.runnerAssignment.findMany({
    where: { orderId, runnerId: { in: runners.map((runner) => runner.id) } },
    select: { runnerId: true },
  });
  const alreadyOffered = new Set(existing.map((assignment) => assignment.runnerId));
  const newRunners = runners.filter((runner) => !alreadyOffered.has(runner.id));
  if (!newRunners.length) return 0;

  await tx.runnerAssignment.createMany({
    data: newRunners.map((runner) => ({ orderId, runnerId: runner.id, status: "OFFERED" })),
    skipDuplicates: true,
  });
  await tx.notification.createMany({
    data: newRunners.map((runner) => ({
      userId: runner.userId,
      type: "DELIVERY",
      title: "New mission 🫡",
      message: "A PackAM order needs a runner.",
      orderId,
      idempotencyKey: `mission-offer:${orderId}:${runner.id}`,
    })),
    skipDuplicates: true,
  });
  return newRunners.length;
}

export async function offerFindingOrdersToRunner(tx: Tx, runnerProfileId: string) {
  const orders = await tx.order.findMany({
    where: { status: "FINDING_RUNNER", assignedRunnerId: null },
    select: { id: true },
    orderBy: { findingRunnerAt: "asc" },
  });
  let offered = 0;
  for (const order of orders) {
    const existing = await tx.runnerAssignment.findUnique({
      where: { orderId_runnerId: { orderId: order.id, runnerId: runnerProfileId } },
      select: { id: true },
    });
    if (existing) continue;
    try {
      await tx.runnerAssignment.create({ data: { orderId: order.id, runnerId: runnerProfileId, status: "OFFERED" } });
      const runner = await tx.runnerProfile.findUnique({ where: { id: runnerProfileId }, select: { userId: true } });
      if (runner) await tx.notification.createMany({ data: [{ userId: runner.userId, type: "DELIVERY", title: "New mission available 🫡", message: "Someone needs their stuff.", orderId: order.id, idempotencyKey: `mission-offer:${order.id}:${runnerProfileId}` }], skipDuplicates: true });
      offered++;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  return offered;
}
