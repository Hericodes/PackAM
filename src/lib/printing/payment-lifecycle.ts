import "server-only";

import { PaymentProvider, Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { createNotification, notifyAdmins } from "../notifications";
import { offerFindingPrintJobToAvailableRunners } from "../orders/runner-assignments";
import { printJobEnterFindingRunnerData } from "../orders/runner-offer-policy";
import { validatePrintPaymentFinalization } from "./payment-snapshot";
import { printMissionReference } from "./runner-mission-policy";
import { transitionPrintJobInTransaction } from "./status";

type VerifiedPrintPayment = {
  transactionReference: string;
  providerReference: string;
  provider: PaymentProvider;
  amount: number;
  currency: string;
  status: "SUCCESS";
};

/**
 * Thrown after a verified provider success was recorded as a second payment for an already-paid
 * print job. The payment is kept in RECONCILIATION_REQUIRED for operations; callers must not report
 * it to the student as a normal confirmation.
 */
export class PrintPaymentNeedsReviewError extends Error {
  constructor(readonly printJobId: string) {
    super("This print job already has a confirmed payment. The extra payment is recorded for operations review.");
    this.name = "PrintPaymentNeedsReviewError";
  }
}

export async function completeVerifiedPrintPayment(verified: VerifiedPrintPayment) {
  if (verified.status !== "SUCCESS" || !verified.transactionReference || !verified.providerReference) {
    throw new Error("A verified successful provider transaction is required.");
  }

  let finalizationStarted = false;
  try {
    const result = await retrySerializable(() => db.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { transactionReference: verified.transactionReference },
      });
      if (!payment) throw new Error("Print payment attempt not found.");
      if (!payment.printJobId) throw new Error("Payment attempt is not linked to this print job.");

      const job = await tx.printJob.findFirst({
        where: { id: payment.printJobId, userId: payment.userId },
        select: {
          id: true,
          userId: true,
          status: true,
          paperSize: true,
          colorMode: true,
          sides: true,
          copies: true,
          pageSelection: true,
          instructions: true,
          pricePerPage: true,
          printSubtotal: true,
          deliveryFee: true,
          total: true,
          pricingVersion: true,
          checkoutSnapshot: true,
          document: { select: { id: true, publicId: true, originalFileName: true, fileSize: true, pageCount: true, mimeType: true, storageProvider: true, deletedAt: true } },
        },
      });
      if (!job) throw new Error("The print job for this payment could not be found.");
      const otherSuccess = payment.status === "SUCCESS" ? null : await tx.payment.findFirst({
        where: { printJobId: job.id, status: "SUCCESS", id: { not: payment.id } },
        select: { id: true },
      });
      const validation = validatePrintPaymentFinalization({ payment, job, verified, otherSuccessfulPayment: Boolean(otherSuccess) });
      if (validation.alreadyProcessed) {
        await offerFindingPrintJobToAvailableRunners(tx, job.id);
        return { orderId: null, printJobId: job.id, alreadyProcessed: true };
      }
      if (validation.duplicate) {
        await recordDuplicatePrintPayment(tx, {
          paymentId: payment.id,
          userId: payment.userId,
          amount: payment.amount,
          printJobId: job.id,
          verified,
          // A cancelled job was never paid: this is a late payment, not a second one.
          jobWasCancelled: job.status === "CANCELLED" && !otherSuccess,
        });
        return { orderId: null, printJobId: job.id, alreadyProcessed: false, duplicatePayment: true as const };
      }
      finalizationStarted = true;
      const confirmedAt = payment.paidAt ?? new Date();
      const claimed = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: payment.status,
          orderId: null,
          printJobId: job.id,
          OR: [{ providerReference: null }, { providerReference: verified.providerReference }],
        },
        data: {
          status: "SUCCESS",
          providerReference: verified.providerReference,
          paidAt: confirmedAt,
        },
      });
      if (claimed.count !== 1) throw new Error("Print payment attempt was already claimed.");

      await transitionPrintJobInTransaction(tx, {
        printJobId: job.id,
        toStatus: "PAYMENT_CONFIRMED",
        note: "Payment verified by OPay.",
      });
      await transitionPrintJobInTransaction(tx, {
        printJobId: job.id,
        toStatus: "FINDING_RUNNER",
        note: "Payment is confirmed; print fulfilment can begin.",
        data: printJobEnterFindingRunnerData(confirmedAt),
      });
      await offerFindingPrintJobToAvailableRunners(tx, job.id);

      return { orderId: null, printJobId: job.id, alreadyProcessed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 8, baseDelayMs: 25 });
    // Raised only after the recording transaction committed, so the record survives.
    if ("duplicatePayment" in result) throw new PrintPaymentNeedsReviewError(result.printJobId);
    return result;
  } catch (error) {
    if (finalizationStarted) {
      try {
        const completed = await db.payment.findUnique({
          where: { transactionReference: verified.transactionReference },
          select: {
            status: true,
            providerReference: true,
            printJobId: true,
            printJob: { select: { status: true } },
          },
        });
        if (
          completed?.status === "SUCCESS" &&
          completed.providerReference === verified.providerReference &&
          completed.printJobId &&
          (completed.printJob?.status === "FINDING_RUNNER" || completed.printJob?.status === "PAYMENT_CONFIRMED")
        ) {
          return { orderId: null, printJobId: completed.printJobId, alreadyProcessed: true };
        }
      } catch (idempotencyError) {
        console.error("PRINT PAYMENT IDEMPOTENCY CHECK ERROR:", idempotencyError instanceof Error ? idempotencyError.name : "Unknown error");
      }
      try {
        await db.payment.updateMany({
          where: {
            transactionReference: verified.transactionReference,
            provider: verified.provider,
            printJobId: { not: null },
            status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] },
            orderId: null,
            OR: [{ providerReference: null }, { providerReference: verified.providerReference }],
          },
          data: {
            status: "RECONCILIATION_REQUIRED",
            providerReference: verified.providerReference,
          },
        });
        // Keep the first time the provider confirmed this money; retries must not move it.
        await db.payment.updateMany({
          where: { transactionReference: verified.transactionReference, providerReference: verified.providerReference, paidAt: null },
          data: { paidAt: new Date() },
        });
      } catch (reconciliationError) {
        console.error("PRINT PAYMENT RECONCILIATION RECORD ERROR:", reconciliationError instanceof Error ? reconciliationError.name : "Unknown error");
      }
      try {
        await db.$transaction((tx) => notifyAdmins(tx, {
          type: "PAYMENT",
          title: "Print payment needs attention",
          message: `Verified print payment ${verified.transactionReference} needs fulfilment reconciliation.`,
          relatedType: "PRINT_JOB",
          idempotencyKey: `print-payment-reconciliation:${verified.transactionReference}`,
        }));
      } catch (notificationError) {
        console.error("PRINT PAYMENT RECONCILIATION ALERT ERROR:", notificationError instanceof Error ? notificationError.name : "Unknown error");
      }
    }
    throw error;
  }
}

/**
 * Records a verified provider success for a print job that was already paid, or that was cancelled
 * before this late payment arrived. The money is not discarded: the attempt keeps the provider
 * reference in RECONCILIATION_REQUIRED (never SUCCESS, so fulfilment cannot start) and operations and
 * the student are told once. Nothing is refunded here; operations must refund through the provider.
 */
async function recordDuplicatePrintPayment(
  tx: Prisma.TransactionClient,
  input: { paymentId: string; userId: string; amount: number; printJobId: string; verified: VerifiedPrintPayment; jobWasCancelled: boolean },
) {
  await tx.payment.updateMany({
    where: {
      id: input.paymentId,
      status: { in: ["PENDING", "FAILED", "RECONCILIATION_REQUIRED"] },
      orderId: null,
      OR: [{ providerReference: null }, { providerReference: input.verified.providerReference }],
    },
    data: { status: "RECONCILIATION_REQUIRED", providerReference: input.verified.providerReference },
  });
  // Keep the first time the provider confirmed this money; repeated callbacks must not move it.
  await tx.payment.updateMany({
    where: { id: input.paymentId, providerReference: input.verified.providerReference, paidAt: null },
    data: { paidAt: new Date() },
  });
  const reference = printMissionReference(input.printJobId);
  await notifyAdmins(tx, input.jobWasCancelled ? {
    type: "PAYMENT",
    title: "Payment received for a cancelled print job",
    message: `OPay confirmed a payment of ₦${input.amount.toLocaleString()} (${input.verified.transactionReference}) for print job ${reference} after it was cancelled. Fulfilment was not started. Check it and refund the payment through OPay.`,
    relatedType: "PRINT_JOB",
    relatedId: input.printJobId,
    idempotencyKey: `print-payment-duplicate:${input.paymentId}`,
  } : {
    type: "PAYMENT",
    title: "Possible double payment for a print job",
    message: `OPay confirmed a second payment of ₦${input.amount.toLocaleString()} (${input.verified.transactionReference}) for print job ${reference}, which was already paid. Fulfilment was not started again. Check it and refund the extra payment through OPay.`,
    relatedType: "PRINT_JOB",
    relatedId: input.printJobId,
    idempotencyKey: `print-payment-duplicate:${input.paymentId}`,
  });
  await createNotification(tx, input.jobWasCancelled ? {
    userId: input.userId,
    type: "PAYMENT",
    title: "Payment received for a cancelled print job",
    message: `We received ₦${input.amount.toLocaleString()} for print job ${reference} after it was cancelled, so it won’t be printed. Our team will review this payment and contact you. Please don’t pay again.`,
    relatedType: "PRINT_JOB",
    relatedId: input.printJobId,
    idempotencyKey: `print-payment-duplicate:${input.paymentId}`,
  } : {
    userId: input.userId,
    type: "PAYMENT",
    title: "We received an extra payment",
    message: `We received a second payment of ₦${input.amount.toLocaleString()} for print job ${reference}. Your job is only being handled once. Our team will review the extra payment and contact you. Please don’t pay again.`,
    relatedType: "PRINT_JOB",
    relatedId: input.printJobId,
    idempotencyKey: `print-payment-duplicate:${input.paymentId}`,
  });
}
