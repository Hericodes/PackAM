import "server-only";

import { randomInt } from "node:crypto";
import { PaymentProvider, Prisma } from "@prisma/client";
import { db } from "../db";
import { writeAuditLogOutsideTransaction } from "../audit";
import { appUrl } from "../app-url";
import { sendEmail } from "../email";
import { confirmedName, transferToConfirmAlert } from "../email/templates";
import { createNotification, notifyAdmins } from "../notifications";
import { completeVerifiedPayment, failPendingPayment } from "./payment-lifecycle";
import {
  MANUAL_CLAIM_REMINDER_AFTER_MS, MANUAL_TRANSFER_GRACE_MS, MANUAL_TRANSFER_WINDOW_MS, checkReceivedAmount, generateTransferCode,
  isManualTransferExpired, manualTransferAccount, manualTransferView, transferResultPath, type ManualTransferView,
} from "./manual-transfer";

/** Marketplace manual attempts only: printing never uses MANUAL. */
const MANUAL_MARKETPLACE = { provider: PaymentProvider.MANUAL, printJobId: null } as const;

/** The oldest an unclaimed attempt may be before it is closed (deadline plus grace). */
const expiryCutoff = (now: Date) => new Date(now.getTime() - MANUAL_TRANSFER_WINDOW_MS - MANUAL_TRANSFER_GRACE_MS);

/**
 * Gives a manual attempt its transfer code and result-page link, once. Safe to call again: a second call (or a
 * concurrent duplicate) keeps the first code. Returns the path the student is sent to.
 */
export async function ensureManualCheckout(reference: string): Promise<string> {
  const path = transferResultPath(reference);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = await db.payment.findUnique({ where: { transactionReference: reference }, select: { transferCode: true } });
    if (existing?.transferCode) return path;
    try {
      const saved = await db.payment.updateMany({
        where: { transactionReference: reference, provider: PaymentProvider.MANUAL, status: "PENDING", transferCode: null },
        data: { transferCode: generateTransferCode(randomInt), cashierUrl: path },
      });
      if (saved.count === 1) return path;
    } catch (error) {
      // Two attempts drew the same code: draw another. Anything else is a real error.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  throw new Error("A transfer code could not be assigned.");
}

/**
 * Closes one unclaimed attempt past its deadline: FAILED, no order, cart untouched, the student told. The WHERE
 * repeats every condition, so a claim or an admin confirmation landing at the same moment wins or loses cleanly.
 */
async function expireOne(paymentId: string, now: Date) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, ...MANUAL_MARKETPLACE, status: "PENDING", orderId: null, transferClaimedAt: null, createdAt: { lte: expiryCutoff(now) } },
      select: { id: true, userId: true, amount: true },
    });
    if (!payment) return false;
    const closed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING", orderId: null, transferClaimedAt: null },
      data: { status: "FAILED", failedAt: now },
    });
    if (closed.count !== 1) return false;
    await createNotification(tx, {
      userId: payment.userId,
      type: "PAYMENT",
      title: "Bank transfer time ran out",
      message: `We didn’t hear that you sent the ₦${payment.amount.toLocaleString()} within 30 minutes, so that checkout was closed. Your cart is still here. If you did send money, contact support with your transfer code.`,
      idempotencyKey: `payment-failed:${payment.id}`,
    });
    return true;
  });
}

/** For the student's own pages: closes this attempt now if it is past its deadline. */
export async function expireManualCheckoutIfStale(paymentId: string, now = new Date()) {
  return expireOne(paymentId, now);
}

/** What the payment-result page needs for a pending manual attempt: the account, code and deadline. */
export async function manualTransferViewFor(payment: { transferCode: string | null; amount: number; transferClaimedAt: Date | null; createdAt: Date }): Promise<ManualTransferView | null> {
  const account = manualTransferAccount(process.env);
  return account ? manualTransferView(account, payment) : null;
}

/** Active admins with a confirmed address: only those get alert emails (no limit is shared with anyone else). */
async function emailAdmins(build: (name: string | null) => Parameters<typeof sendEmail>[0] | null) {
  const admins = await db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE", emailVerifiedAt: { not: null } }, select: { email: true, firstName: true, emailVerifiedAt: true } });
  await Promise.all(admins.map(async (admin) => {
    const message = build(confirmedName(admin));
    if (message) await sendEmail({ ...message, to: admin.email, toConfirmedAddress: true });
  }));
}

/** Never throws: an alert email that can't be sent must not undo or block the claim (the in-app alert is written). */
async function emailTransferAlert(amount: number, code: string, reminder: boolean) {
  try {
    const link = appUrl("/admin/payments");
    await emailAdmins((name) => ({ ...transferToConfirmAlert(name, amount, code, link, reminder), to: "", purpose: reminder ? "manual-transfer-reminder" : "manual-transfer-claim" }));
  } catch (error) {
    console.error("MANUAL TRANSFER ALERT EMAIL ERROR:", error instanceof Error ? error.name : "Unknown error");
  }
}

export type ClaimResult =
  | { status: 200; body: { status: "PENDING"; claimed: true } | { status: "SUCCESS"; orderId: string | null } | { status: "FAILED" } }
  | { status: 404 | 409; body: { error: string } };

/**
 * The student says they have sent the money. This only records the claim and alerts every admin (in the app and by
 * email) to check the bank app; it never changes the payment's money state. Repeating it is harmless and alerts once.
 * A claim is accepted until the deadline plus the grace; after that the attempt is closed instead.
 */
export async function claimManualTransfer(userId: string, reference: string, now = new Date()): Promise<ClaimResult> {
  const payment = await db.payment.findFirst({
    where: { transactionReference: reference, userId, ...MANUAL_MARKETPLACE },
    select: { id: true, status: true, orderId: true, amount: true, transferCode: true, transferClaimedAt: true, createdAt: true, user: { select: { firstName: true, lastName: true, email: true } } },
  });
  if (!payment) return { status: 404, body: { error: "Payment attempt not found." } };
  if (payment.status === "SUCCESS") return { status: 200, body: { status: "SUCCESS", orderId: payment.orderId } };
  if (payment.status === "FAILED") return { status: 200, body: { status: "FAILED" } };
  if (!payment.transferCode) return { status: 409, body: { error: "This payment has no transfer details yet. Go back to checkout and request the account number again." } };
  if (payment.status === "PENDING" && isManualTransferExpired(payment, now)) {
    await expireOne(payment.id, now);
    const latest = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true, orderId: true } });
    if (latest?.status === "SUCCESS") return { status: 200, body: { status: "SUCCESS", orderId: latest.orderId } };
    if (latest?.status === "FAILED") return { status: 200, body: { status: "FAILED" } };
  }

  const outcome = await db.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] }, orderId: null, transferClaimedAt: null, createdAt: { gt: expiryCutoff(now) } },
      data: { transferClaimedAt: now },
    });
    if (claimed.count !== 1) return "NOT_CLAIMED" as const;
    const name = [payment.user.firstName, payment.user.lastName].filter(Boolean).join(" ") || payment.user.email;
    await notifyAdmins(tx, {
      type: "PAYMENT",
      title: "Transfer to confirm",
      message: `${name} says they sent ₦${payment.amount.toLocaleString()} (code ${payment.transferCode}). Check your bank app, then confirm or reject it under Payments.`,
      idempotencyKey: `manual-transfer-claim:${payment.id}`,
    });
    return "CLAIMED" as const;
  });
  if (outcome === "CLAIMED") {
    await emailTransferAlert(payment.amount, payment.transferCode, false);
    return { status: 200, body: { status: "PENDING", claimed: true } };
  }
  // Already claimed earlier (fine), or the payment moved on meanwhile (closed, rejected, confirmed): say what it is now.
  const latest = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true, orderId: true, transferClaimedAt: true } });
  if (latest?.status === "SUCCESS") return { status: 200, body: { status: "SUCCESS", orderId: latest.orderId } };
  if (latest?.status === "FAILED") return { status: 200, body: { status: "FAILED" } };
  if (!latest?.transferClaimedAt) return { status: 409, body: { error: "We couldn’t record that right now. Nothing has changed — please try again." } };
  return { status: 200, body: { status: "PENDING", claimed: true } };
}

/**
 * Lets a student drop a manual checkout they haven't paid for. Only a checkout they have NOT said they paid is
 * failed here, so a student who has sent money can't cancel it out from under the admin who is about to confirm it.
 */
export async function failUnclaimedManualCheckout(userId: string, reference: string): Promise<{ claimed: boolean }> {
  const payment = await db.payment.findFirst({
    where: { transactionReference: reference, userId, ...MANUAL_MARKETPLACE, status: "PENDING", orderId: null },
    select: { id: true, transferClaimedAt: true },
  });
  if (!payment) return { claimed: false };
  if (payment.transferClaimedAt) return { claimed: true };
  await db.payment.updateMany({ where: { id: payment.id, status: "PENDING", orderId: null, transferClaimedAt: null }, data: { status: "FAILED", failedAt: new Date() } });
  return { claimed: false };
}

/** Bounded work per scheduled run; anything left is picked up five minutes later. */
const SCHEDULED_BATCH = 50;

/**
 * The scheduled pass (every 5 minutes, with dispatch): closes unclaimed attempts past their deadline, and reminds
 * every admin, once per payment, about a claim still waiting 30 minutes after the student said they paid. A claimed
 * payment is never closed here. Never throws for one payment; counts what it did.
 */
export async function runManualTransferHousekeeping(now = new Date()) {
  const result = { expired: 0, reminded: 0, failed: 0 };
  const stale = await db.payment.findMany({
    where: { ...MANUAL_MARKETPLACE, status: "PENDING", orderId: null, transferClaimedAt: null, createdAt: { lte: expiryCutoff(now) } },
    orderBy: { createdAt: "asc" },
    take: SCHEDULED_BATCH,
    select: { id: true },
  });
  for (const payment of stale) {
    try {
      if (await expireOne(payment.id, now)) result.expired += 1;
    } catch (error) {
      result.failed += 1;
      console.error("MANUAL TRANSFER EXPIRY ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
  }
  const waiting = await db.payment.findMany({
    where: { ...MANUAL_MARKETPLACE, status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] }, orderId: null, transferClaimedAt: { lte: new Date(now.getTime() - MANUAL_CLAIM_REMINDER_AFTER_MS) } },
    orderBy: { transferClaimedAt: "asc" },
    take: SCHEDULED_BATCH,
    select: { id: true, amount: true, transferCode: true },
  });
  for (const payment of waiting) {
    try {
      const written = await db.$transaction((tx) => notifyAdmins(tx, {
        type: "PAYMENT",
        title: "Transfer still waiting",
        message: `A student said they sent ₦${payment.amount.toLocaleString()} (code ${payment.transferCode ?? "none"}) over 30 minutes ago. Confirm or reject it under Payments.`,
        idempotencyKey: `manual-transfer-reminder:${payment.id}`,
      }));
      // Emailed only the first time the reminder is written, so a run every 5 minutes doesn't repeat it.
      if (written > 0) {
        result.reminded += 1;
        await emailTransferAlert(payment.amount, payment.transferCode ?? "none", true);
      }
    } catch (error) {
      result.failed += 1;
      console.error("MANUAL TRANSFER REMINDER ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
  }
  return result;
}

export type ManualAdminResult = { status: number; body: Record<string, unknown> };

async function loadManualPayment(paymentId: string) {
  return db.payment.findFirst({
    where: { id: paymentId, ...MANUAL_MARKETPLACE },
    select: { id: true, status: true, amount: true, currency: true, orderId: true, transactionReference: true, transferCode: true, transferClaimedAt: true, userId: true },
  });
}

/**
 * An admin has seen the credit in the bank app. The admin must enter the amount received; below the order's amount
 * nothing happens. Then the order is created through the same idempotent completion every provider uses, so
 * confirming twice (two admins, a double click) still creates exactly one order.
 */
export async function confirmManualPayment(adminId: string, paymentId: string, receivedAmount: unknown): Promise<ManualAdminResult> {
  const payment = await loadManualPayment(paymentId);
  if (!payment || !payment.transactionReference) return { status: 404, body: { error: "Manual payment not found." } };
  if (payment.status === "SUCCESS") return { status: 200, body: { message: "Already confirmed.", orderId: payment.orderId } };
  if (payment.status === "FAILED" || payment.status === "REFUNDED") {
    return { status: 409, body: { error: "This checkout was already closed (rejected, cancelled or out of time), so it can’t be confirmed and no order was made. If the money did arrive, refund it, or ask the student to check out again and confirm that new payment." } };
  }

  const check = checkReceivedAmount(receivedAmount, payment.amount);
  if (!check.ok) return { status: 400, body: { error: check.error } };

  let result: Awaited<ReturnType<typeof completeVerifiedPayment>>;
  try {
    result = await completeVerifiedPayment({
      transactionReference: payment.transactionReference,
      // Unique per attempt; there is no bank-side transaction id to record, so the audit row carries the details.
      providerReference: `manual:${payment.id}`,
      provider: PaymentProvider.MANUAL,
      amount: payment.amount,
      currency: payment.currency,
      status: "SUCCESS",
    });
  } catch (error) {
    // Another admin rejected it, or the student cancelled it, a moment ago: say so instead of a generic failure.
    const latest = await loadManualPayment(paymentId).catch(() => null);
    if (latest?.status === "FAILED") return { status: 409, body: { error: "This payment was rejected or closed a moment ago, so it wasn’t confirmed. Refresh the list." } };
    throw error;
  }
  if (!result.alreadyProcessed) {
    await writeAuditLogOutsideTransaction({
      actorId: adminId,
      action: "payment.manual_confirmed",
      resource: "Payment",
      resourceId: payment.id,
      previousState: { paymentStatus: payment.status },
      newState: { paymentStatus: "SUCCESS", orderId: result.orderId, receivedAmount: receivedAmount as number },
      details: `Admin confirmed a manual bank transfer. Code ${payment.transferCode ?? "none"}, expected ₦${payment.amount}, received ₦${receivedAmount}${check.extra ? ` (₦${check.extra} extra to refund or credit)` : ""}.`,
    }).catch((error) => console.error("MANUAL CONFIRM AUDIT ERROR:", error instanceof Error ? error.name : "Unknown error"));
  }
  return { status: 200, body: { message: check.extra ? `Confirmed. The student sent ₦${check.extra.toLocaleString()} extra, so refund or credit it separately.` : "Confirmed. The order is on its way to runners.", orderId: result.orderId, extra: check.extra } };
}

/** The money never arrived (or was wrong and isn't being fixed): fail the attempt. No order is made; the cart stays. */
export async function rejectManualPayment(adminId: string, paymentId: string, note: unknown): Promise<ManualAdminResult> {
  const payment = await loadManualPayment(paymentId);
  if (!payment || !payment.transactionReference) return { status: 404, body: { error: "Manual payment not found." } };
  if (payment.status === "SUCCESS") return { status: 409, body: { error: "This payment is already confirmed, so it can’t be rejected." } };
  const reason = typeof note === "string" ? note.trim().slice(0, 300) : "";
  if (payment.status === "FAILED") return { status: 200, body: { message: "Already rejected." } };
  const failed = await failPendingPayment(payment.transactionReference);
  if (!failed) return { status: 409, body: { error: "This payment can’t be rejected in its current state. Refresh and try again." } };
  await writeAuditLogOutsideTransaction({
    actorId: adminId,
    action: "payment.manual_rejected",
    resource: "Payment",
    resourceId: payment.id,
    previousState: { paymentStatus: payment.status },
    newState: { paymentStatus: "FAILED" },
    details: `Admin rejected a manual bank transfer (code ${payment.transferCode ?? "none"}).${reason ? ` Note: ${reason}` : ""}`,
  }).catch((error) => console.error("MANUAL REJECT AUDIT ERROR:", error instanceof Error ? error.name : "Unknown error"));
  return { status: 200, body: { message: "Rejected. The student has been told and their cart is untouched." } };
}
