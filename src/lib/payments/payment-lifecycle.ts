import "server-only";

import { randomUUID } from "node:crypto";
import { PaymentProvider, Prisma } from "@prisma/client";
import { auth } from "../../auth";
import { db } from "../db";
import { CHECKOUT_CURRENCY, CHECKOUT_DELIVERY_FEE } from "../checkout-pricing";
import { transitionOrderInTransaction } from "../orders/transition";
import { offerFindingOrderToAvailableRunners } from "../orders/runner-assignments";
import { createNotification, notifyAdmins } from "../notifications";

type SnapshotItem = {
  cartItemId: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
};

type CheckoutSnapshot = {
  cartId: string;
  items: SnapshotItem[];
  subtotal: number;
  deliveryFee: number;
  deliveryLocationId: string;
  deliveryAddress: string;
  deliveryInstructions: string | null;
};

export type VerifiedProviderPayment = {
  /** PackAM reference returned by createPaymentAttempt. */
  transactionReference: string;
  /** Reference from the provider's verified transaction record. */
  providerReference: string;
  provider: PaymentProvider;
  amount: number;
  currency: string;
  status: "SUCCESS";
};

/**
 * Creates a PENDING attempt from the authenticated student's current database cart.
 * The provider must be selected by server code, never copied from browser input.
 */
export async function createPaymentAttempt(
  provider: PaymentProvider,
  deliveryLocationId: string,
  idempotencyKey: string,
  deliveryInstructions?: string | null,
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "STUDENT") {
    throw new Error("A student session is required to start checkout payment.");
  }

  const key = idempotencyKey.trim();
  if (!key || key.length > 128) {
    throw new Error("A valid payment idempotency key is required.");
  }
  if (!deliveryLocationId) {
    throw new Error("A delivery location is required.");
  }
  if (deliveryInstructions !== undefined && deliveryInstructions !== null && deliveryInstructions.length > 500) {
    throw new Error("Delivery instructions must be 500 characters or fewer.");
  }

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.payment.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: session.user.id,
            idempotencyKey: key,
          },
        },
        select: {
          id: true,
          transactionReference: true,
          provider: true,
          status: true,
          amount: true,
          currency: true,
          orderId: true,
        },
      });
      if (existing) return existing;

      const student = await tx.user.findFirst({
        where: { id: session.user.id, role: "STUDENT", status: "ACTIVE" },
        select: { id: true },
      });
      if (!student) throw new Error("This student account is not active.");

      const [cart, location] = await Promise.all([
        tx.cart.findUnique({
          where: { userId: student.id },
          select: {
            id: true,
            items: {
              select: {
                id: true,
                productId: true,
                quantity: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    customerPrice: true,
                    status: true,
                    category: { select: { isActive: true } },
                  },
                },
              },
            },
          },
        }),
        tx.savedLocation.findFirst({
          where: { id: deliveryLocationId, userId: student.id },
          select: { id: true, address: true, instructions: true },
        }),
      ]);

      if (!cart?.items.length) throw new Error("Your cart is empty.");
      if (!location) throw new Error("Choose one of your saved delivery locations.");

      const items: SnapshotItem[] = cart.items.map((item) => {
        if (item.product.status !== "ACTIVE" || !item.product.category.isActive) {
          throw new Error(`${item.product.name} is no longer available.`);
        }
        if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
          throw new Error("A cart item has an invalid quantity.");
        }
        const unitPrice = item.product.customerPrice;
        return {
          cartItemId: item.id,
          productId: item.product.id,
          productName: item.product.name,
          unitPrice,
          quantity: item.quantity,
          totalPrice: unitPrice * item.quantity,
        };
      });

      const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
      const amount = subtotal + CHECKOUT_DELIVERY_FEE;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error("The checkout amount is invalid.");
      }

      const snapshot: CheckoutSnapshot = {
        cartId: cart.id,
        items,
        subtotal,
        deliveryFee: CHECKOUT_DELIVERY_FEE,
        deliveryLocationId: location.id,
        deliveryAddress: location.address,
        deliveryInstructions: deliveryInstructions === undefined ? location.instructions : deliveryInstructions,
      };

      return tx.payment.create({
        data: {
          userId: student.id,
          provider,
          status: "PENDING",
          amount,
          currency: CHECKOUT_CURRENCY,
          transactionReference: `packam_${randomUUID()}`,
          idempotencyKey: key,
          checkoutSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          transactionReference: true,
          provider: true,
          status: true,
          amount: true,
          currency: true,
          orderId: true,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    // If two retries race with the same key, return the attempt created by the winner.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.payment.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: session.user.id,
            idempotencyKey: key,
          },
        },
        select: {
          id: true,
          transactionReference: true,
          provider: true,
          status: true,
          amount: true,
          currency: true,
          orderId: true,
        },
      });
      if (existing) return existing;
    }
    throw error;
  }
}

function parseSnapshot(value: Prisma.JsonValue | null): CheckoutSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Payment attempt has no valid checkout snapshot.");
  }
  const raw = value as Prisma.JsonObject;
  const itemsValue = raw.items;
  if (!Array.isArray(itemsValue) || itemsValue.length === 0) {
    throw new Error("Payment attempt snapshot has no items.");
  }
  const items = itemsValue.map((value): SnapshotItem => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Payment attempt contains an invalid item snapshot.");
    }
    const item = value as Prisma.JsonObject;
    const fields = ["cartItemId", "productId", "productName"] as const;
    for (const field of fields) {
      if (typeof item[field] !== "string" || !item[field]) {
        throw new Error("Payment attempt contains an invalid item snapshot.");
      }
    }
    const numbers = [item.unitPrice, item.quantity, item.totalPrice];
    if (!numbers.every((number) => typeof number === "number" && Number.isSafeInteger(number))) {
      throw new Error("Payment attempt contains invalid item amounts.");
    }
    const snapshotItem = {
      cartItemId: item.cartItemId as string,
      productId: item.productId as string,
      productName: item.productName as string,
      unitPrice: item.unitPrice as number,
      quantity: item.quantity as number,
      totalPrice: item.totalPrice as number,
    };
    if (snapshotItem.quantity < 1 || snapshotItem.unitPrice < 0 || snapshotItem.totalPrice !== snapshotItem.unitPrice * snapshotItem.quantity) {
      throw new Error("Payment attempt contains inconsistent item amounts.");
    }
    return snapshotItem;
  });

  const subtotal = raw.subtotal;
  const deliveryFee = raw.deliveryFee;
  if (typeof subtotal !== "number" || !Number.isSafeInteger(subtotal) || typeof deliveryFee !== "number" || !Number.isSafeInteger(deliveryFee)) {
    throw new Error("Payment attempt contains invalid totals.");
  }
  if (typeof raw.cartId !== "string" || typeof raw.deliveryLocationId !== "string" || typeof raw.deliveryAddress !== "string") {
    throw new Error("Payment attempt contains incomplete delivery details.");
  }
  if (raw.deliveryInstructions !== null && typeof raw.deliveryInstructions !== "string") {
    throw new Error("Payment attempt contains invalid delivery instructions.");
  }
  if (items.reduce((sum, item) => sum + item.totalPrice, 0) !== subtotal) {
    throw new Error("Payment attempt subtotal does not match its items.");
  }

  return {
    cartId: raw.cartId,
    items,
    subtotal,
    deliveryFee,
    deliveryLocationId: raw.deliveryLocationId,
    deliveryAddress: raw.deliveryAddress,
    deliveryInstructions: raw.deliveryInstructions,
  };
}

/**
 * Call only after a provider adapter has verified the webhook signature and
 * independently confirmed the transaction with the provider. Never expose this
 * function through a browser-facing route.
 */
export async function completeVerifiedPayment(verified: VerifiedProviderPayment) {
  if (verified.status !== "SUCCESS" || !verified.transactionReference || !verified.providerReference) {
    throw new Error("A verified successful provider transaction is required.");
  }

  let finalizationStarted = false;
  try {
    return await db.$transaction(async (tx) => {
    const attempt = await tx.payment.findUnique({
      where: { transactionReference: verified.transactionReference },
    });
    if (!attempt) throw new Error("Payment attempt not found.");
    if (attempt.provider !== verified.provider) throw new Error("Payment provider does not match the attempt.");
    if (attempt.amount !== verified.amount || attempt.currency !== verified.currency.toUpperCase()) {
      throw new Error("Verified payment amount or currency does not match the checkout.");
    }

    if (attempt.status === "SUCCESS") {
      if (attempt.providerReference !== verified.providerReference || !attempt.orderId) {
        throw new Error("Payment attempt was already completed with a different transaction.");
      }
      return { orderId: attempt.orderId, alreadyProcessed: true };
    }
    if (!["PENDING", "RECONCILIATION_REQUIRED"].includes(attempt.status) || attempt.orderId) {
      throw new Error("Payment attempt is no longer pending.");
    }
    if (attempt.providerReference && attempt.providerReference !== verified.providerReference) {
      throw new Error("Payment attempt was already verified with a different provider transaction.");
    }

    const snapshot = parseSnapshot(attempt.checkoutSnapshot);
    if (attempt.amount !== snapshot.subtotal + snapshot.deliveryFee) {
      throw new Error("Payment amount does not match the saved checkout snapshot.");
    }
    finalizationStarted = true;

    const location = await tx.savedLocation.findFirst({
      where: { id: snapshot.deliveryLocationId, userId: attempt.userId },
      select: { id: true },
    });
    const confirmedAt = new Date();
    const order = await tx.order.create({
      data: {
        userId: attempt.userId,
        status: "PAYMENT_CONFIRMED",
        findingRunnerAt: new Date(),
        subtotal: snapshot.subtotal,
        deliveryFee: snapshot.deliveryFee,
        total: attempt.amount,
        currency: attempt.currency,
        deliveryLocationId: location?.id ?? null,
        deliveryAddress: snapshot.deliveryAddress,
        deliveryInstructions: snapshot.deliveryInstructions,
        items: {
          create: snapshot.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
          })),
        },
        statusHistory: {
          create: {
            status: "PAYMENT_CONFIRMED",
            note: "Payment verified by provider.",
            createdAt: confirmedAt,
          },
        },
      },
      select: { id: true },
    });

    await transitionOrderInTransaction(tx, {
      orderId: order.id,
      toStatus: "FINDING_RUNNER",
      note: "Order is ready for runner assignment.",
    });
    const claim = await tx.payment.updateMany({
      where: {
        id: attempt.id,
        status: attempt.status,
        orderId: null,
        OR: [{ providerReference: null }, { providerReference: verified.providerReference }],
      },
      data: {
        status: "SUCCESS",
        providerReference: verified.providerReference,
        paidAt: attempt.paidAt ?? confirmedAt,
        orderId: order.id,
      },
    });
    if (claim.count !== 1) throw new Error("Payment attempt was already claimed.");

    // Remove only quantities captured by this attempt. Later cart edits/additions survive.
    for (const item of snapshot.items) {
      const currentItem = await tx.cartItem.findFirst({
        where: { id: item.cartItemId, cartId: snapshot.cartId, productId: item.productId },
        select: { quantity: true },
      });
      if (!currentItem) continue;
      if (currentItem.quantity <= item.quantity) {
        await tx.cartItem.delete({ where: { id: item.cartItemId } });
      } else {
        await tx.cartItem.update({
          where: { id: item.cartItemId },
          data: { quantity: { decrement: item.quantity } },
        });
      }
    }

await offerFindingOrderToAvailableRunners(tx, order.id);

    return { orderId: order.id, alreadyProcessed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (finalizationStarted) {
      try {
        await db.payment.updateMany({
          where: {
            transactionReference: verified.transactionReference,
            provider: verified.provider,
            status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] },
            orderId: null,
            OR: [{ providerReference: null }, { providerReference: verified.providerReference }],
          },
          data: {
            status: "RECONCILIATION_REQUIRED",
            providerReference: verified.providerReference,
            paidAt: new Date(),
          },
        });
      } catch (reconciliationError) {
        console.error("PAYMENT RECONCILIATION RECORD ERROR:", reconciliationError instanceof Error ? reconciliationError.name : "Unknown error");
      }
      try {
        await db.$transaction((tx) => notifyAdmins(tx, { type: "PAYMENT", title: "Payment needs attention", message: `Verified payment ${verified.transactionReference} needs order reconciliation.`, idempotencyKey: `payment-reconciliation:${verified.transactionReference}` }));
      } catch (notificationError) {
        console.error("PAYMENT RECONCILIATION ALERT ERROR:", notificationError instanceof Error ? notificationError.name : "Unknown error");
      }
    }
    throw error;
  }
}

/** Mark a verified terminal provider failure without creating an order or touching the cart. */
export async function failPendingPayment(transactionReference: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { transactionReference, status: "PENDING", orderId: null }, select: { id: true, userId: true, amount: true } });
    if (!payment) return false;
    const result = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING", orderId: null }, data: { status: "FAILED", failedAt: new Date() } });
    if (result.count !== 1) return false;
    await createNotification(tx, { userId: payment.userId, type: "PAYMENT", title: "Payment failed", message: `Payment failed — ₦${payment.amount.toLocaleString()}. Your cart is still here.`, idempotencyKey: `payment-failed:${payment.id}` });
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Preserve an uncertain provider attempt for operations review; never convert it to SUCCESS/FAILED. */
export async function markPaymentNeedsReview(transactionReference: string, reason: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { transactionReference, provider: "OPAY", status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] }, orderId: null }, select: { id: true, userId: true, amount: true, status: true } });
    if (!payment) return false;
    if (payment.status === "PENDING") {
      const changed = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING", orderId: null }, data: { status: "RECONCILIATION_REQUIRED" } });
      if (changed.count !== 1) return false;
    }
    await createNotification(tx, { userId: payment.userId, type: "PAYMENT", title: "Payment requires attention", message: `Payment of ₦${payment.amount.toLocaleString()} needs a manual check. Please don’t pay again yet.`, idempotencyKey: `payment-review:${payment.id}` });
    await notifyAdmins(tx, { type: "PAYMENT", title: "Payment needs attention", message: `PackAM payment ${transactionReference} needs review (${reason.slice(0, 120)}).`, idempotencyKey: `payment-review-admin:${payment.id}` });
    return true;
  });
}
