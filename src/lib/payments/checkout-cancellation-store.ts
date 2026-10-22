import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { createNotification } from "../notifications";
import { removeCheckoutItemsFromCart } from "./payment-lifecycle";
import { checkOpayPaymentStatus, type VerificationDeps } from "./opay-verification";
import { opayStatusDeps, verificationDepsFor } from "./gateways";
import { SUPPORTED_PROVIDERS } from "./provider-selection";
import type { CancelFailedResult, CancellationDeps, CheckoutAttemptView } from "./checkout-cancellation";

/** Re-exported for existing imports; defined with the other provider deps in gateways.ts. */
export { opayStatusDeps };

// The audit row is the durable "cancelled by student" marker; the payment itself stays FAILED.
const CANCEL_AUDIT = { action: "checkout.cancelled_by_student", resource: "Payment" } as const;

export async function isCheckoutCancelled(paymentId: string, tx: Prisma.TransactionClient = db) {
  const marker = await tx.auditLog.findFirst({ where: { ...CANCEL_AUDIT, resourceId: paymentId }, select: { id: true } });
  return marker !== null;
}

/** Marketplace OPay attempt owned by this student. Another student's reference is simply not found. */
function findOwnedAttempt(reference: string, userId: string) {
  return db.payment.findFirst({
    where: { transactionReference: reference, userId, provider: { in: [...SUPPORTED_PROVIDERS] }, printJobId: null },
    select: { id: true, status: true, orderId: true, amount: true, currency: true, providerCheckoutReference: true, provider: true },
  });
}

/** Set when PackAM operations closes a student's unpaid checkout; the student's cart is left alone. */
export type CheckoutCancelAdmin = { adminId: string };

async function cancelFailedCheckout(paymentId: string, userId: string, admin?: CheckoutCancelAdmin): Promise<CancelFailedResult> {
  return retrySerializable(() => db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, userId, provider: { in: [...SUPPORTED_PROVIDERS] }, printJobId: null },
      select: { id: true, status: true, orderId: true, amount: true, createdAt: true, checkoutSnapshot: true },
    });
    if (!payment || payment.status !== "FAILED" || payment.orderId) return "NOT_FAILED";
    if (await isCheckoutCancelled(payment.id, tx)) return "ALREADY_CANCELLED";
    if (admin) {
      // Operations closes the dead checkout only: no cart change, so nothing the student still wants is removed.
      await writeAuditLog(tx, {
        actorId: admin.adminId,
        ...CANCEL_AUDIT,
        resourceId: payment.id,
        previousState: { paymentStatus: payment.status },
        newState: { paymentStatus: payment.status, cancelledByAdmin: true },
        details: "Admin cancelled an unpaid checkout after OPay verified the payment as not completed. Cart left unchanged.",
      });
      await createNotification(tx, {
        userId,
        type: "PAYMENT",
        title: "Unpaid order closed",
        message: `PackAM closed your unpaid order of ₦${payment.amount.toLocaleString()} because OPay didn’t complete the payment. Your cart is unchanged.`,
        idempotencyKey: `checkout-cancelled:${payment.id}`,
      });
      return "CANCELLED";
    }
    // A newer checkout may be paying for the same cart items; cancelling this one must not remove them.
    const newer = await tx.payment.findFirst({
      where: { userId, printJobId: null, id: { not: payment.id }, createdAt: { gt: payment.createdAt } },
      select: { id: true },
    });
    if (newer) return "SUPERSEDED";

    await writeAuditLog(tx, {
      actorId: userId,
      ...CANCEL_AUDIT,
      resourceId: payment.id,
      previousState: { paymentStatus: payment.status },
      newState: { paymentStatus: payment.status, cancelledByStudent: true },
      details: "Student cancelled an unpaid checkout after OPay reported the payment as not completed.",
    });
    await removeCheckoutItemsFromCart(tx, payment.checkoutSnapshot);
    await createNotification(tx, {
      userId,
      type: "PAYMENT",
      title: "Order cancelled",
      message: `You cancelled your unpaid order of ₦${payment.amount.toLocaleString()}. We removed those items from your cart — no wahala.`,
      idempotencyKey: `checkout-cancelled:${payment.id}`,
    });
    return "CANCELLED";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 6, baseDelayMs: 25 });
}

export async function checkoutAttemptView(attempt: { id: string; status: CheckoutAttemptView["status"]; orderId: string | null }): Promise<CheckoutAttemptView> {
  return { status: attempt.status, orderId: attempt.orderId, cancelled: attempt.status === "FAILED" ? await isCheckoutCancelled(attempt.id) : false };
}

/** `verification` overrides the attempt's own provider (tests); by default each attempt uses its provider. */
export function checkoutCancellationDeps(reference: string, userId: string, verification?: VerificationDeps, admin?: CheckoutCancelAdmin): CancellationDeps {
  let paymentId: string | null = null;
  return {
    async findAttempt() {
      const attempt = await findOwnedAttempt(reference, userId);
      if (!attempt) return null;
      paymentId = attempt.id;
      return checkoutAttemptView(attempt);
    },
    async reconcile() {
      const attempt = await findOwnedAttempt(reference, userId);
      if (!attempt || attempt.status !== "PENDING") return;
      // Same trusted path as the status poll: errors are logged and reported as "still pending".
      await checkOpayPaymentStatus(
        { reference, amount: attempt.amount, currency: attempt.currency, providerCheckoutReference: attempt.providerCheckoutReference },
        verification ?? verificationDepsFor(attempt.provider),
      );
    },
    async cancelFailed() {
      if (!paymentId) return "NOT_FAILED";
      return cancelFailedCheckout(paymentId, userId, admin);
    },
  };
}
