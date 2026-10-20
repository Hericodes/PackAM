import "server-only";

import { PaymentProvider, Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { createNotification } from "../notifications";
import { completeVerifiedPayment, failPendingPayment, markPaymentNeedsReview, removeCheckoutItemsFromCart } from "./payment-lifecycle";
import { queryPaymentStatus } from "./providers/opay";
import { checkOpayPaymentStatus, consolePaymentLogger, type VerificationDeps } from "./opay-verification";
import type { CancelFailedResult, CancellationDeps, CheckoutAttemptView } from "./checkout-cancellation";

/** The trusted OPay verification used by the student's status check and by cancellation. */
export const opayStatusDeps: VerificationDeps = {
  queryStatus: queryPaymentStatus,
  complete: (verified) => completeVerifiedPayment({ ...verified, provider: PaymentProvider.OPAY, status: "SUCCESS" }),
  fail: failPendingPayment,
  markReview: markPaymentNeedsReview,
  log: consolePaymentLogger,
};

// The audit row is the durable "cancelled by student" marker; the payment itself stays FAILED.
const CANCEL_AUDIT = { action: "checkout.cancelled_by_student", resource: "Payment" } as const;

export async function isCheckoutCancelled(paymentId: string, tx: Prisma.TransactionClient = db) {
  const marker = await tx.auditLog.findFirst({ where: { ...CANCEL_AUDIT, resourceId: paymentId }, select: { id: true } });
  return marker !== null;
}

/** Marketplace OPay attempt owned by this student. Another student's reference is simply not found. */
function findOwnedAttempt(reference: string, userId: string) {
  return db.payment.findFirst({
    where: { transactionReference: reference, userId, provider: PaymentProvider.OPAY, printJobId: null },
    select: { id: true, status: true, orderId: true, amount: true, currency: true, providerCheckoutReference: true },
  });
}

async function cancelFailedCheckout(paymentId: string, userId: string): Promise<CancelFailedResult> {
  return retrySerializable(() => db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, userId, provider: PaymentProvider.OPAY, printJobId: null },
      select: { id: true, status: true, orderId: true, amount: true, createdAt: true, checkoutSnapshot: true },
    });
    if (!payment || payment.status !== "FAILED" || payment.orderId) return "NOT_FAILED";
    if (await isCheckoutCancelled(payment.id, tx)) return "ALREADY_CANCELLED";
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
      message: `You cancelled your unpaid order of ₦${payment.amount.toLocaleString()} and we removed those items from your cart.`,
      idempotencyKey: `checkout-cancelled:${payment.id}`,
    });
    return "CANCELLED";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 6, baseDelayMs: 25 });
}

export async function checkoutAttemptView(attempt: { id: string; status: CheckoutAttemptView["status"]; orderId: string | null }): Promise<CheckoutAttemptView> {
  return { status: attempt.status, orderId: attempt.orderId, cancelled: attempt.status === "FAILED" ? await isCheckoutCancelled(attempt.id) : false };
}

export function checkoutCancellationDeps(reference: string, userId: string, verification: VerificationDeps = opayStatusDeps): CancellationDeps {
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
        verification,
      );
    },
    async cancelFailed() {
      if (!paymentId) return "NOT_FAILED";
      return cancelFailedCheckout(paymentId, userId);
    },
  };
}
