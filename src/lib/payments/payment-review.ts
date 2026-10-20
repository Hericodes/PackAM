import "server-only";

import { PaymentProvider, Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { notifyAdmins } from "../notifications";
import { opayStatusDeps, checkoutCancellationDeps } from "./checkout-cancellation-store";
import { cancelUnpaidCheckout } from "./checkout-cancellation";
import { verifyOpayPaymentDetailed, type DetailedVerification, type VerificationDeps } from "./opay-verification";
import { describeCheck, validateReviewNote, VERIFY_LOCK_MS } from "./payment-review-policy";
import { cancelUnpaidPrintJob } from "../printing/print-cancellation";
import { printCancellationDeps } from "../printing/print-cancellation-store";

export const PAYMENT_REVIEW_AUDIT = {
  verify: "PAYMENT_VERIFICATION_RETRIED",
  verifiedFailed: "PAYMENT_REVIEW_VERIFIED_FAILED",
  close: "PAYMENT_REVIEW_CLOSED",
  reopen: "PAYMENT_REVIEW_REOPENED",
  escalate: "PAYMENT_REVIEW_ESCALATED",
} as const;

type ActionResult = { status: number; body: Record<string, unknown> };

function loadPayment(paymentId: string) {
  return db.payment.findFirst({
    where: { id: paymentId, provider: PaymentProvider.OPAY },
    select: { id: true, userId: true, status: true, amount: true, currency: true, orderId: true, printJobId: true, transactionReference: true, providerReference: true, providerCheckoutReference: true, paidAt: true },
  });
}

async function ensureCase(paymentId: string) {
  try {
    await db.paymentReviewCase.upsert({ where: { paymentId }, create: { paymentId }, update: {} });
  } catch (error) {
    // Two admins opening the same case at once: the other request created it.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
}

/**
 * A payment held in review that never captured money (no provider transaction, no paid time, no
 * order) is moved to FAILED only because OPay's signed status record now verifies it failed or closed.
 * Attempts holding captured money (late or duplicate successes) never match and stay in review.
 */
async function failVerifiedReviewPayment(reference: string, adminId: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { transactionReference: reference, status: "RECONCILIATION_REQUIRED", orderId: null, providerReference: null, paidAt: null },
      select: { id: true },
    });
    if (!payment) return false;
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: "RECONCILIATION_REQUIRED", orderId: null, providerReference: null, paidAt: null },
      data: { status: "FAILED", failedAt: new Date() },
    });
    if (changed.count !== 1) return false;
    await writeAuditLog(tx, {
      actorId: adminId,
      action: PAYMENT_REVIEW_AUDIT.verifiedFailed,
      resource: "Payment",
      resourceId: payment.id,
      previousState: { paymentStatus: "RECONCILIATION_REQUIRED" },
      newState: { paymentStatus: "FAILED" },
      details: "OPay's signed status record verified this attempt as failed or closed; no money was captured for it.",
    });
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** The trusted verification deps for an admin-triggered check. Identical to the status poll except for review holds. */
export function adminVerificationDeps(adminId: string, base: VerificationDeps = opayStatusDeps): VerificationDeps {
  return {
    ...base,
    fail: async (reference) => (await base.fail(reference)) || (await failVerifiedReviewPayment(reference, adminId)),
  };
}

export async function retryPaymentVerification(adminId: string, paymentId: string, verification?: VerificationDeps): Promise<ActionResult> {
  const payment = await loadPayment(paymentId);
  if (!payment) return { status: 404, body: { error: "Payment not found." } };
  if (!payment.transactionReference || (payment.status !== "PENDING" && payment.status !== "RECONCILIATION_REQUIRED")) {
    return { status: 409, body: { error: `This payment is ${payment.status.toLowerCase().replaceAll("_", " ")}, so there is nothing for OPay to confirm. Resolve it with a documented note instead.` } };
  }
  await ensureCase(payment.id);

  // One check per payment at a time, however many admins click.
  const now = new Date();
  const locked = await db.paymentReviewCase.updateMany({
    where: { paymentId: payment.id, OR: [{ checkLockedUntil: null }, { checkLockedUntil: { lt: now } }] },
    data: { checkLockedUntil: new Date(now.getTime() + VERIFY_LOCK_MS) },
  });
  if (locked.count !== 1) return { status: 409, body: { error: "A verification for this payment is already running. Wait a few seconds and refresh." } };

  let result: DetailedVerification;
  try {
    result = await verifyOpayPaymentDetailed(
      { reference: payment.transactionReference, amount: payment.amount, currency: payment.currency, providerCheckoutReference: payment.providerCheckoutReference },
      adminVerificationDeps(adminId, verification),
    );
  } catch (error) {
    result = { outcome: "NOT_APPLIED", providerStatus: null, errorName: error instanceof Error ? error.name : "UnknownError" };
  }
  const after = await loadPayment(payment.id);
  const detail = describeCheck(result);
  await db.$transaction(async (tx) => {
    await tx.paymentReviewCase.update({
      where: { paymentId: payment.id },
      data: { lastCheckAt: new Date(), lastCheckOutcome: result.outcome, lastCheckDetail: detail.slice(0, 300), checkCount: { increment: 1 }, checkLockedUntil: null },
    });
    await writeAuditLog(tx, {
      actorId: adminId,
      action: PAYMENT_REVIEW_AUDIT.verify,
      resource: "Payment",
      resourceId: payment.id,
      previousState: { paymentStatus: payment.status },
      newState: { paymentStatus: after?.status ?? payment.status, outcome: result.outcome },
      details: detail.slice(0, 300),
    });
  });
  return { status: 200, body: { outcome: result.outcome, detail, paymentStatus: after?.status ?? payment.status } };
}

export async function cancelLinkedUnpaid(adminId: string, paymentId: string, verification: VerificationDeps = opayStatusDeps): Promise<ActionResult> {
  const payment = await loadPayment(paymentId);
  if (!payment) return { status: 404, body: { error: "Payment not found." } };
  if (payment.orderId) return { status: 409, body: { error: "This payment is linked to a paid order, so there is no unpaid order to cancel. Use the order’s refund process if needed." } };
  if (payment.status === "RECONCILIATION_REQUIRED") return { status: 409, body: { error: "This payment is under review. Retry verification first; cancelling is only possible once OPay confirms it wasn’t paid." } };
  if (!payment.transactionReference) return { status: 409, body: { error: "This payment has no PackAM reference, so it can’t be checked with OPay." } };

  const result = payment.printJobId
    ? await cancelUnpaidPrintJob(printCancellationDeps(payment.printJobId, { id: adminId, role: "ADMIN" }, verification))
    : await cancelUnpaidCheckout(checkoutCancellationDeps(payment.transactionReference, payment.userId, verification, { adminId }));
  const what = payment.printJobId ? "print job" : "unpaid order";
  switch (result.kind) {
    case "CANCELLED":
      return { status: 200, body: { cancelled: true, alreadyCancelled: result.alreadyCancelled, message: result.alreadyCancelled ? `This ${what} was already cancelled.` : `The ${what} is cancelled. The payment record is unchanged (OPay reported it as not completed).` } };
    case "PAID":
      return { status: 409, body: { error: `OPay confirms this payment succeeded, so the ${what} was not cancelled. Fulfilment continues normally.` } };
    case "STILL_PENDING":
      return { status: 409, body: { error: `OPay still reports this payment as pending, or couldn’t be reached. Cancelling now could discard a real payment, so nothing was changed. Retry verification later.` } };
    case "UNDER_REVIEW":
      return { status: 409, body: { error: "The payment moved into review during the check. Retry verification before cancelling." } };
    case "SUPERSEDED":
      return { status: 409, body: { error: "A newer payment exists for this student’s cart; this checkout was not cancelled." } };
    case "NOT_FOUND":
      return { status: 404, body: { error: `The linked ${what} wasn’t found.` } };
  }
}

async function caseSnapshot(tx: Prisma.TransactionClient, paymentId: string) {
  const [reviewCase, payment] = await Promise.all([
    tx.paymentReviewCase.findUnique({ where: { paymentId }, select: { id: true, status: true, lastCheckOutcome: true, lastCheckAt: true } }),
    tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } }),
  ]);
  return { reviewCase, paymentStatus: payment.status };
}

export async function closeReviewCase(adminId: string, paymentId: string, note: unknown): Promise<ActionResult> {
  const valid = validateReviewNote(note);
  if (!valid.ok) return { status: 400, body: { error: valid.error } };
  if (!(await loadPayment(paymentId))) return { status: 404, body: { error: "Payment not found." } };
  return retrySerializable(() => db.$transaction(async (tx) => {
    const before = await caseSnapshot(tx, paymentId);
    if (before.reviewCase?.status === "CLOSED") return { status: 409, body: { error: "This review case is already closed." } };
    const closed = { status: "CLOSED" as const, closedAt: new Date(), closedById: adminId, closeNote: valid.note, checkLockedUntil: null };
    if (before.reviewCase) {
      const changed = await tx.paymentReviewCase.updateMany({ where: { paymentId, status: "OPEN" }, data: closed });
      if (changed.count !== 1) return { status: 409, body: { error: "This review case is already closed." } };
    } else {
      await tx.paymentReviewCase.create({ data: { paymentId, ...closed } });
    }
    // The payment row is deliberately untouched: closing a case is not a statement about money.
    await writeAuditLog(tx, {
      actorId: adminId,
      action: PAYMENT_REVIEW_AUDIT.close,
      resource: "Payment",
      resourceId: paymentId,
      previousState: { caseStatus: before.reviewCase?.status ?? "NONE", paymentStatus: before.paymentStatus, lastCheckOutcome: before.reviewCase?.lastCheckOutcome ?? null },
      newState: { caseStatus: "CLOSED", paymentStatus: before.paymentStatus },
      details: valid.note,
    });
    return { status: 200, body: { caseStatus: "CLOSED", paymentStatus: before.paymentStatus } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 5, baseDelayMs: 25 });
}

export async function reopenReviewCase(adminId: string, paymentId: string, note: unknown): Promise<ActionResult> {
  const valid = validateReviewNote(note);
  if (!valid.ok) return { status: 400, body: { error: valid.error } };
  return retrySerializable(() => db.$transaction(async (tx) => {
    const reviewCase = await tx.paymentReviewCase.findUnique({ where: { paymentId }, select: { status: true, closeNote: true } });
    if (!reviewCase) return { status: 404, body: { error: "There is no review case for this payment." } };
    const changed = await tx.paymentReviewCase.updateMany({ where: { paymentId, status: "CLOSED" }, data: { status: "OPEN", closedAt: null, closedById: null, closeNote: null } });
    if (changed.count !== 1) return { status: 409, body: { error: "This review case is already open." } };
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } });
    await writeAuditLog(tx, {
      actorId: adminId,
      action: PAYMENT_REVIEW_AUDIT.reopen,
      resource: "Payment",
      resourceId: paymentId,
      previousState: { caseStatus: "CLOSED", closeNote: reviewCase.closeNote, paymentStatus: payment.status },
      newState: { caseStatus: "OPEN", paymentStatus: payment.status },
      details: valid.note,
    });
    return { status: 200, body: { caseStatus: "OPEN", paymentStatus: payment.status } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 5, baseDelayMs: 25 });
}

export async function escalateReviewCase(adminId: string, paymentId: string, note: unknown): Promise<ActionResult> {
  const valid = validateReviewNote(note);
  if (!valid.ok) return { status: 400, body: { error: valid.error } };
  const payment = await loadPayment(paymentId);
  if (!payment) return { status: 404, body: { error: "Payment not found." } };
  await ensureCase(paymentId);
  return db.$transaction(async (tx) => {
    const escalatedAt = new Date();
    const changed = await tx.paymentReviewCase.updateMany({ where: { paymentId, status: "OPEN" }, data: { escalatedAt } });
    if (changed.count !== 1) return { status: 409, body: { error: "Reopen this review case before escalating it." } };
    await writeAuditLog(tx, {
      actorId: adminId,
      action: PAYMENT_REVIEW_AUDIT.escalate,
      resource: "Payment",
      resourceId: paymentId,
      previousState: { paymentStatus: payment.status },
      newState: { paymentStatus: payment.status, caseStatus: "OPEN", escalated: true },
      details: valid.note,
    });
    await notifyAdmins(tx, {
      type: "PAYMENT",
      title: "Payment review escalated",
      message: `Payment ${payment.transactionReference ?? payment.id} (₦${payment.amount.toLocaleString()}) was escalated and stays unresolved: ${valid.note.slice(0, 160)}`,
      idempotencyKey: `payment-review-escalated:${paymentId}:${escalatedAt.getTime()}`,
    });
    return { status: 200, body: { caseStatus: "OPEN", escalatedAt: escalatedAt.toISOString(), paymentStatus: payment.status } };
  });
}
