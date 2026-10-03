import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { isPriceIncreaseWithinConfiguredTolerance } from "./price-policy";
import { getRunnerAcceptanceTimeoutMinutes } from "./price-policy";
import { offerFindingOrdersToRunner } from "./runner-assignments";
import { startRefundWorkflow } from "./refunds";
import { transitionOrderInTransaction } from "./transition";
import { hasCompleteSourcing, hasUnresolvedUnavailableItems } from "./sourcing-completion";
import { createNotification, notifyAdmins } from "../notifications";

export async function setRunnerAvailability(userId: string, available: boolean) {
  return db.$transaction(async (tx) => {
    const runner = await tx.runnerProfile.findFirst({
      where: { userId, isVerified: true, user: { role: "RUNNER", status: "ACTIVE" } },
      select: { id: true },
    });
    if (!runner) throw new Error("Your runner profile is not active and verified.");
    await tx.runnerProfile.update({ where: { id: runner.id }, data: { isAvailable: available } });
    const offered = available ? await offerFindingOrdersToRunner(tx, runner.id) : 0;
    return { available, offered };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function acceptRunnerMission(userId: string, orderId: string) {
  return db.$transaction(async (tx) => {
    const runner = await tx.runnerProfile.findFirst({
      where: { userId, isAvailable: true, isVerified: true, user: { role: "RUNNER", status: "ACTIVE" } },
      select: { id: true, userId: true },
    });
    if (!runner) throw new Error("You need to be verified and available to accept a mission.");
    const assignment = await tx.runnerAssignment.findUnique({
      where: { orderId_runnerId: { orderId, runnerId: runner.id } },
      select: { id: true, status: true },
    });
    if (!assignment || assignment.status !== "OFFERED") throw new Error("This mission is no longer available.");
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, findingRunnerAt: true, userId: true },
    });
    if (!order || order.status !== "FINDING_RUNNER") throw new Error("Someone already picked this mission 🫡");
    const timeoutMinutes = getRunnerAcceptanceTimeoutMinutes();
    if (order.findingRunnerAt && Date.now() - order.findingRunnerAt.getTime() > timeoutMinutes * 60_000) {
      throw new Error("This mission has expired.");
    }

    await transitionOrderInTransaction(tx, {
      orderId,
      toStatus: "RUNNER_ASSIGNED",
      actorId: userId,
      note: "A verified runner accepted the mission.",
      guard: { assignedRunnerId: null },
      data: { assignedRunnerId: runner.id },
    });
    const accepted = await tx.runnerAssignment.updateMany({
      where: { id: assignment.id, status: "OFFERED" },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (accepted.count !== 1) throw new Error("Someone already picked this mission 🫡");
    await tx.runnerAssignment.updateMany({
      where: { orderId, id: { not: assignment.id }, status: "OFFERED" },
      data: { status: "EXPIRED" },
    });
return { accepted: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

type SourcingInput = {
  orderItemId: string;
  vendorId: string;
  result: "AVAILABLE" | "UNAVAILABLE";
  quantity?: number;
  actualUnitPrice?: number;
};

export async function reportSourcing(userId: string, orderId: string, input: SourcingInput) {
  return db.$transaction(async (tx) => {
    const { runner, order } = await getAssignedOrder(tx, userId, orderId);
    if (!["RUNNER_ASSIGNED", "SOURCING_PRODUCT"].includes(order.status)) throw new Error("This order is not accepting sourcing updates.");
    const item = await tx.orderItem.findFirst({
      where: { id: input.orderItemId, orderId },
      select: { id: true, productId: true, productName: true, unitPrice: true, quantity: true },
    });
    if (!item) throw new Error("Order item not found.");
    const vendor = await tx.vendor.findFirst({ where: { id: input.vendorId, status: "ACTIVE" }, select: { id: true, name: true } });
    if (!vendor) throw new Error("Choose an active shop.");

    const productSource = await tx.productSource.upsert({
      where: { productId_vendorId: { productId: item.productId, vendorId: vendor.id } },
      create: { productId: item.productId, vendorId: vendor.id },
      update: {},
      select: { id: true },
    });
    const orderSource = await tx.orderSource.upsert({
      where: { orderId_vendorId: { orderId, vendorId: vendor.id } },
      create: { orderId, vendorId: vendor.id },
      update: {},
      select: { id: true },
    });

    if (input.result === "UNAVAILABLE") {
      const sourcing = await tx.orderItemSourcing.create({
        data: {
          orderItemId: item.id,
          orderSourceId: orderSource.id,
          productSourceId: productSource.id,
          reportedByRunnerId: runner.id,
          status: "UNAVAILABLE",
          quantity: 0,
          catalogueUnitPrice: item.unitPrice,
        },
      });
      await tx.productSource.update({ where: { id: productSource.id }, data: { availability: "UNAVAILABLE" } });
      await tx.availabilityRecord.create({ data: { productSourceId: productSource.id, availability: "UNAVAILABLE" } });
      await tx.incident.create({
        data: {
          orderId,
          reportedById: runner.userId,
          type: "PRODUCT_UNAVAILABLE",
          description: `${item.productName} was unavailable at ${vendor.name}.`,
        },
      });
      await notifyAdmins(tx, { type: "SYSTEM", title: "Product unavailable", message: `${item.productName} was unavailable at ${vendor.name} for order ${orderId}.`, orderId, idempotencyKey: `product-unavailable:${sourcing.id}` });
      await notifyStudent(tx, order.userId, orderId, "Product availability update", `${item.productName} wasn’t available at ${vendor.name}. We’re checking other shops.`);
      if (order.status === "RUNNER_ASSIGNED") {
        await transitionOrderInTransaction(tx, { orderId, toStatus: "SOURCING_PRODUCT", actorId: userId, note: "Runner began sourcing the order." });
        await notifyStudent(tx, order.userId, orderId, "We’re getting your stuff", "Your order is being sourced around campus.");
      }
      return { sourcingId: sourcing.id, status: sourcing.status };
    }

    const quantity = input.quantity;
    const actualUnitPrice = input.actualUnitPrice ?? item.unitPrice;
    if (!Number.isInteger(quantity) || !quantity || quantity < 1 || !Number.isSafeInteger(actualUnitPrice) || actualUnitPrice < 0) {
      throw new Error("Enter a valid sourced quantity and price.");
    }
    const prior = await tx.orderItemSourcing.aggregate({
      where: { orderItemId: item.id, status: { in: ["SOURCED", "APPROVED", "PRICE_PENDING"] } },
      _sum: { quantity: true },
    });
    const remaining = item.quantity - (prior._sum.quantity ?? 0);
    if (quantity > remaining) throw new Error(`Only ${remaining} unit${remaining === 1 ? "" : "s"} remain to source.`);

    const isIncrease = actualUnitPrice > item.unitPrice;
    const autoApproved = isPriceIncreaseWithinConfiguredTolerance(item.unitPrice, actualUnitPrice);
    const status = isIncrease && !autoApproved ? "PRICE_PENDING" : actualUnitPrice === item.unitPrice ? "SOURCED" : "APPROVED";
    const sourcing = await tx.orderItemSourcing.create({
      data: {
        orderItemId: item.id,
        orderSourceId: orderSource.id,
        productSourceId: productSource.id,
        reportedByRunnerId: runner.id,
        status,
        quantity,
        catalogueUnitPrice: item.unitPrice,
        actualUnitPrice,
        autoApproved: status === "APPROVED" && autoApproved,
      },
    });
    await tx.productSource.update({ where: { id: productSource.id }, data: { availability: "AVAILABLE", currentPrice: actualUnitPrice } });
    await tx.availabilityRecord.create({ data: { productSourceId: productSource.id, availability: "AVAILABLE" } });
    if (actualUnitPrice !== item.unitPrice) {
      await tx.priceRecord.create({ data: { productSourceId: productSource.id, price: actualUnitPrice } });
    }
    if (status === "PRICE_PENDING") {
      await tx.incident.create({
        data: {
          orderId,
          reportedById: runner.userId,
          type: "PRICE_CHANGE",
          description: `${item.productName} costs ₦${actualUnitPrice.toLocaleString()} at ${vendor.name}; checkout price was ₦${item.unitPrice.toLocaleString()}.`,
        },
      });
      await notifyStudent(tx, order.userId, orderId, "Small price change 👀", `${item.productName} is ₦${actualUnitPrice.toLocaleString()} at ${vendor.name}, instead of ₦${item.unitPrice.toLocaleString()}. Choose Continue or Cancel & Refund.`);
    }
    if (order.status === "RUNNER_ASSIGNED") {
      await transitionOrderInTransaction(tx, { orderId, toStatus: "SOURCING_PRODUCT", actorId: userId, note: "Runner began sourcing the order." });
      await notifyStudent(tx, order.userId, orderId, "We’re getting your stuff", "Your order is being sourced around campus.");
    }
    return { sourcingId: sourcing.id, status };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function decidePriceChange(userId: string, orderId: string, sourcingId: string, decision: "CONTINUE" | "CANCEL") {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, userId }, select: { id: true, status: true, total: true } });
    if (!order) throw new Error("Order not found.");
    const sourcing = await tx.orderItemSourcing.findFirst({
      where: { id: sourcingId, orderItem: { orderId } },
      select: { id: true, status: true, quantity: true },
    });
    if (!sourcing) throw new Error("Price change not found.");
    if (decision === "CANCEL") {
      if (sourcing.status === "REJECTED" && order.status === "REFUND_PROCESSING") return { decision, status: "REFUND_PROCESSING" };
      if (sourcing.status !== "PRICE_PENDING" || order.status !== "SOURCING_PRODUCT") throw new Error("This price decision is no longer available.");
      await tx.orderItemSourcing.updateMany({
        where: { id: sourcing.id, status: "PRICE_PENDING" },
        data: { status: "REJECTED", priceDecisionAt: new Date(), priceDecisionBy: userId },
      });
      await startRefundWorkflow(tx, { orderId, reason: "PRICE_CHANGE_REJECTED", actorId: userId, note: "Student declined the sourcing price change." });
      return { decision, status: "REFUND_PROCESSING" };
    }
    if (sourcing.status === "APPROVED" || sourcing.status === "SOURCED") return { decision, status: sourcing.status };
    if (sourcing.status !== "PRICE_PENDING" || order.status !== "SOURCING_PRODUCT") throw new Error("This price decision is no longer available.");
    const changed = await tx.orderItemSourcing.updateMany({
      where: { id: sourcing.id, status: "PRICE_PENDING" },
      data: { status: "APPROVED", priceDecisionAt: new Date(), priceDecisionBy: userId },
    });
    if (changed.count !== 1) throw new Error("This price decision was already submitted.");
    const assignment = await tx.order.findUnique({ where: { id: orderId }, select: { assignedRunner: { select: { userId: true } } } });
    if (assignment?.assignedRunner) {
      await tx.notification.create({
        data: { userId: assignment.assignedRunner.userId, type: "DELIVERY", title: "Price approved", message: "The student approved the updated shop price. You can continue sourcing.", orderId },
      });
    }
    return { decision, status: "APPROVED" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function startOrderDelivery(userId: string, orderId: string) {
  return db.$transaction(async (tx) => {
    const { runner, order } = await getAssignedOrder(tx, userId, orderId);
    if (order.status !== "SOURCING_PRODUCT") throw new Error("This order is not being sourced.");
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: {
        id: true,
        quantity: true,
        productName: true,
        sourcing: { select: { status: true, quantity: true } },
      },
    });
    const pendingPrice = items.some((item) => item.sourcing.some((entry) => entry.status === "PRICE_PENDING"));
    if (pendingPrice) throw new Error("A price change is waiting for the student’s decision.");
    if (hasUnresolvedUnavailableItems(items)) {
      await startRefundWorkflow(tx, { orderId, reason: "PRODUCT_UNAVAILABLE", actorId: userId, note: "Required items could not be sourced." });
      return { status: "REFUND_PROCESSING" as const };
    }
    if (!hasCompleteSourcing(items)) throw new Error("Every required item must be sourced before delivery starts.");
    await transitionOrderInTransaction(tx, {
      orderId,
      toStatus: "OUT_FOR_DELIVERY",
      actorId: userId,
      note: "Assigned runner started delivery after completing sourcing.",
      guard: { assignedRunnerId: runner.id },
    });
    await notifyStudent(tx, order.userId, orderId, "Your package is on the way 👀", "The runner has started delivery.");
    return { status: "OUT_FOR_DELIVERY" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reportDeliveryIssue(userId: string, orderId: string, type: "CUSTOMER_UNAVAILABLE" | "DELIVERY_ISSUE" | "WRONG_ITEM" | "MISSING_ITEM" | "DAMAGED_ITEM" | "OTHER", description: string) {
  return db.$transaction(async (tx) => {
    const { runner, order } = await getAssignedOrder(tx, userId, orderId);
    if (order.status !== "OUT_FOR_DELIVERY") throw new Error("Delivery issues can only be reported while the order is out for delivery.");
    const incident = await tx.incident.create({
      data: { orderId, reportedById: runner.userId, type, description: description.trim() || null },
      select: { id: true, type: true, status: true },
    });
    await notifyStudent(tx, order.userId, orderId, "Delivery update", "The runner reported a delivery issue. PackAM operations is reviewing it.");
    await notifyAdmins(tx, { type: "DELIVERY", title: "Delivery incident requires attention", message: `Runner reported ${type} for order ${orderId}.`, orderId, idempotencyKey: `incident:${incident.id}` });
    return incident;
  });
}

export async function markOrderDelivered(userId: string, orderId: string) {
  return db.$transaction(async (tx) => {
    const { runner, order } = await getAssignedOrder(tx, userId, orderId);
    if (order.status !== "OUT_FOR_DELIVERY") throw new Error("Finish sourcing and start delivery before marking delivered.");
    await transitionOrderInTransaction(tx, {
      orderId,
      toStatus: "DELIVERED",
      actorId: userId,
      note: "Runner completed the delivery.",
      guard: { assignedRunnerId: runner.id },
      data: { deliveredAt: new Date() },
    });
    const assignment = await tx.runnerAssignment.updateMany({
      where: { orderId, runnerId: runner.id, status: "ACCEPTED" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (assignment.count !== 1) throw new Error("Runner assignment is no longer active.");
    await tx.runnerProfile.update({
      where: { id: runner.id },
      data: { totalDeliveries: { increment: 1 }, completedDeliveries: { increment: 1 } },
    });
    await notifyStudent(tx, order.userId, orderId, "Your package don land 🎒", "Your order has been delivered.");
    return { status: "DELIVERED" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function getAssignedOrder(tx: Prisma.TransactionClient, userId: string, orderId: string) {
  const runner = await tx.runnerProfile.findFirst({
    where: { userId, isVerified: true, user: { role: "RUNNER", status: "ACTIVE" } },
    select: { id: true, userId: true },
  });
  if (!runner) throw new Error("Your runner profile is not active and verified.");
  const assignment = await tx.runnerAssignment.findFirst({
    where: { orderId, runnerId: runner.id, status: "ACCEPTED" },
    select: { id: true },
  });
  if (!assignment) throw new Error("This order is not assigned to you.");
  const order = await tx.order.findFirst({
    where: { id: orderId, assignedRunnerId: runner.id },
    select: { id: true, userId: true, status: true },
  });
  if (!order) throw new Error("Assigned order not found.");
  return { runner, assignment, order };
}

async function notifyStudent(tx: Prisma.TransactionClient, userId: string, orderId: string, title: string, message: string) {
  if (message === "The runner has started delivery." || message === "Your order has been delivered." || message === "Your order is being sourced around campus.") return;
  await createNotification(tx, { userId, orderId, type: "ORDER", title, message, idempotencyKey: `order:${orderId}:${title}` });
}
