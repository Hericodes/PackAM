import { OrderStatus } from "@prisma/client";

const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ["PAYMENT_CONFIRMED", "FAILED"],
  PAYMENT_CONFIRMED: ["FINDING_RUNNER", "REFUND_PROCESSING"],
  FINDING_RUNNER: ["RUNNER_ASSIGNED", "REFUND_PROCESSING", "CANCELLED"],
  RUNNER_ASSIGNED: ["SOURCING_PRODUCT", "REFUND_PROCESSING"],
  SOURCING_PRODUCT: ["OUT_FOR_DELIVERY", "REFUND_PROCESSING"],
  OUT_FOR_DELIVERY: ["DELIVERED", "REFUND_PROCESSING"],
  DELIVERED: [],
  CANCELLED: ["REFUND_PROCESSING"],
  REFUND_PROCESSING: ["REFUNDED", "FAILED"],
  REFUNDED: [],
  FAILED: ["REFUND_PROCESSING"],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus) {
  return allowedTransitions[from].includes(to);
}
