import "server-only";

import { Prisma } from "@prisma/client";
import { transitionOrderInTransaction } from "./transition";
import { createNotification, notifyAdmins } from "../notifications";

type Tx = Prisma.TransactionClient;

export async function startRefundWorkflow(
  tx: Tx,
  input: { orderId: string; reason: string; actorId?: string | null; note?: string },
) {
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: {
      payment: { select: { status: true, amount: true } },
      assignedRunner: { select: { userId: true } },
    },
  });
  if (!order) throw new Error("Order not found.");
  if (!order.payment || order.payment.amount !== order.total || !["SUCCESS", "RECONCILIATION_REQUIRED"].includes(order.payment.status)) {
    throw new Error("Only a captured payment can enter the refund workflow.");
  }

  if (order.status !== "REFUND_PROCESSING" && order.status !== "REFUNDED") {
    await transitionOrderInTransaction(tx, {
      orderId: order.id,
      toStatus: "REFUND_PROCESSING",
      actorId: input.actorId,
      note: input.note ?? `Refund started: ${input.reason}`,
    });
  }

  const refund = await tx.refund.upsert({
    where: { requestKey: `${order.id}:full` },
    create: {
      orderId: order.id,
      requestKey: `${order.id}:full`,
      amount: order.total,
      reason: input.reason,
      status: "PENDING",
    },
    update: {},
  });
  await tx.runnerAssignment.updateMany({
    where: { orderId: order.id, status: { in: ["OFFERED", "ACCEPTED"] } },
    data: { status: "CANCELLED" },
  });
  if (refund.status === "FAILED") await notifyAdmins(tx, { type: "PAYMENT", title: "Refund requires attention", message: `Refund ${refund.id} failed for order ${order.id}.`, orderId: order.id, idempotencyKey: `refund-failed:${refund.id}` });
  if (order.assignedRunner) {
    await createNotification(tx, {
        userId: order.assignedRunner.userId,
        type: "DELIVERY",
        title: "Mission cancelled",
        message: "This order has moved to refund processing. Please stop fulfilment.",
        orderId: order.id,
        idempotencyKey: `refund-runner-cancel:${refund.id}`,
    });
  }
  return refund;
}
