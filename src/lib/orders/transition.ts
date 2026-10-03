import "server-only";

import { OrderStatus, Prisma } from "@prisma/client";
import { canTransitionOrder } from "./state-machine";
import { createNotification } from "../notifications";

const studentEvents: Partial<Record<OrderStatus, { type: "ORDER" | "PAYMENT" | "DELIVERY"; title: string; message: (total: number) => string }>> = {
  PAYMENT_CONFIRMED: { type: "PAYMENT", title: "Order confirmed", message: () => "We’ve got your order 🫡" },
  RUNNER_ASSIGNED: { type: "DELIVERY", title: "Runner assigned", message: () => "Someone has accepted the mission." },
  SOURCING_PRODUCT: { type: "ORDER", title: "We’re getting your stuff", message: () => "Your order is being sourced around campus." },
  OUT_FOR_DELIVERY: { type: "DELIVERY", title: "On the move", message: () => "Your package is on the move 👀" },
  DELIVERED: { type: "DELIVERY", title: "Delivered", message: () => "Your package don land. 🎒" },
  REFUND_PROCESSING: { type: "PAYMENT", title: "Refund initiated", message: (total) => `Refund initiated — ₦${total.toLocaleString()}` },
};

export async function transitionOrderInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    toStatus: OrderStatus;
    actorId?: string | null;
    note: string;
    guard?: Prisma.OrderWhereInput;
    data?: Prisma.OrderUncheckedUpdateManyInput;
  },
) {
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, status: true, userId: true, total: true },
  });
  if (!order) throw new Error("Order not found.");
  if (!canTransitionOrder(order.status, input.toStatus)) {
    throw new Error(`Order cannot move from ${order.status} to ${input.toStatus}.`);
  }

  const changed = await tx.order.updateMany({
    where: { id: order.id, status: order.status, ...input.guard },
    data: { ...input.data, status: input.toStatus },
  });
  if (changed.count !== 1) throw new Error("Order status changed while this action was being processed.");
  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      status: input.toStatus,
      note: input.note,
      createdBy: input.actorId ?? null,
    },
  });
  const event = studentEvents[input.toStatus];
  if (event) await createNotification(tx, { userId: order.userId, orderId: order.id, type: event.type, title: event.title, message: event.message(order.total), idempotencyKey: `order-event:${order.id}:${input.toStatus}` });
  return { previousStatus: order.status, status: input.toStatus };
}
