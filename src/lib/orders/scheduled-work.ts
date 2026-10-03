import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { getRunnerAcceptanceTimeoutMinutes } from "./price-policy";
import { startRefundWorkflow } from "./refunds";
import { notifyAdmins } from "../notifications";

/** Call periodically from a platform scheduler. It is safe to run repeatedly. */
export async function expireUnclaimedRunnerOrders(now = new Date()) {
  const cutoff = new Date(now.getTime() - getRunnerAcceptanceTimeoutMinutes() * 60_000);
  const overdue = await db.order.findMany({
    where: { status: "FINDING_RUNNER", assignedRunnerId: null, findingRunnerAt: { lte: cutoff } },
    select: { id: true },
    take: 100,
    orderBy: { findingRunnerAt: "asc" },
  });

  let started = 0;
  for (const candidate of overdue) {
    try {
      const changed = await db.$transaction(async (tx) => {
        const current = await tx.order.findUnique({
          where: { id: candidate.id },
          select: { id: true, status: true, assignedRunnerId: true, findingRunnerAt: true },
        });
        if (!current || current.status !== "FINDING_RUNNER" || current.assignedRunnerId || !current.findingRunnerAt || current.findingRunnerAt > cutoff) return false;
        await startRefundWorkflow(tx, {
          orderId: current.id,
          reason: "NO_RUNNER",
          note: "No eligible runner accepted this mission before its deadline.",
        });
        await notifyAdmins(tx, { type: "DELIVERY", title: "No runner accepted order", message: `Order ${current.id} passed its runner acceptance window.`, orderId: current.id, idempotencyKey: `no-runner:${current.id}` });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (changed) started++;
    } catch (error) {
      console.error("RUNNER TIMEOUT PROCESSING ERROR:", candidate.id, error instanceof Error ? error.name : "Unknown error");
    }
  }
  return { scanned: overdue.length, refundsStarted: started };
}
