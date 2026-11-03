import "server-only";

import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { sendEmail } from "../email";
import { confirmedName, paymentPinNotice } from "../email/templates";
import { createNotification, notifyAdmins } from "../notifications";
import { afterWrongPin, checkNewPin, isPinLocked, isPinShaped, lockedMessage, wrongPinMessage } from "./payment-pin";

/**
 * Admin payment PINs (see payment-pin.ts for why). Every confirm or reject of a bank transfer calls verifyPaymentPin
 * first. Fails closed: no PIN set, a locked PIN, or a database without the AdminPaymentPin table all refuse the action.
 * Wrong tries are counted inside a serializable transaction, so parallel guesses can't get more than the limit.
 */

const PIN_COST = 12;

export type PinVerdict =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 423; code: "PIN_REQUIRED" | "PIN_NOT_SET" | "WRONG_PIN" | "PIN_LOCKED"; error: string };

async function activeAdmin(userId: string) {
  return db.user.findFirst({ where: { id: userId, role: "ADMIN", status: "ACTIVE" }, select: { id: true, email: true, firstName: true, emailVerifiedAt: true, passwordHash: true } });
}

/** Never throws: a notice that can't be emailed must not undo the change (the in-app notice and audit row are written). */
async function emailNotice(userId: string, kind: Parameters<typeof paymentPinNotice>[1]) {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true, emailVerifiedAt: true } });
    if (!user) return;
    await sendEmail({ ...paymentPinNotice(confirmedName(user), kind), to: user.email, toConfirmedAddress: Boolean(user.emailVerifiedAt), purpose: `payment-pin-${kind}` });
  } catch (error) {
    console.error("PAYMENT PIN NOTICE ERROR:", error instanceof Error ? error.name : "Unknown error");
  }
}

/** Whether this admin has a PIN (and whether it is locked now), for the admin page. */
export async function paymentPinStatus(userId: string, now = new Date()) {
  const row = await db.adminPaymentPin.findUnique({ where: { userId }, select: { setAt: true, updatedAt: true, failedCount: true, lockedUntil: true } });
  return row ? { set: true as const, setAt: row.setAt, locked: isPinLocked(row, now), lockedUntil: row.lockedUntil } : { set: false as const };
}

/**
 * Checks `pin` against this admin's PIN. A wrong PIN counts towards the lock; the try that locks it alerts this admin
 * and every other admin. A right PIN clears the count. Each wrong try is audited.
 */
export async function verifyPaymentPin(adminId: string, pin: unknown, purpose: string, now = new Date()): Promise<PinVerdict> {
  if (!isPinShaped(pin)) return { ok: false, status: 400, code: "PIN_REQUIRED", error: "Enter your 6-digit payment PIN." };
  const verdict = await retrySerializable(() => db.$transaction(async (tx) => {
    const row = await tx.adminPaymentPin.findUnique({ where: { userId: adminId } });
    if (!row) return { ok: false, status: 403, code: "PIN_NOT_SET", error: "Set your payment PIN on the Payments page first." } as const;
    if (isPinLocked(row, now)) return { ok: false, status: 423, code: "PIN_LOCKED", error: lockedMessage(row.lockedUntil!, now) } as const;
    if (await bcrypt.compare(pin, row.pinHash)) {
      if (row.failedCount !== 0 || row.lockedUntil) await tx.adminPaymentPin.update({ where: { userId: adminId }, data: { failedCount: 0, lockedUntil: null } });
      return { ok: true } as const;
    }
    const next = afterWrongPin(row, now);
    await tx.adminPaymentPin.update({ where: { userId: adminId }, data: { failedCount: next.failedCount, lockedUntil: next.lockedUntil } });
    await writeAuditLog(tx, {
      actorId: adminId,
      action: next.lockedNow ? "payment_pin.locked" : "payment_pin.wrong",
      resource: "AdminPaymentPin",
      resourceId: adminId,
      newState: { failedCount: next.failedCount, locked: next.lockedNow },
      details: `Wrong payment PIN for ${purpose.slice(0, 80)}.${next.lockedNow ? " PIN locked." : ""}`,
    });
    if (next.lockedNow) {
      await notifyAdmins(tx, {
        type: "SYSTEM",
        title: "An admin payment PIN was locked",
        message: "Someone entered an admin’s payment PIN wrongly 5 times in a row, so it is locked for 15 minutes. Check the audit log; if it wasn’t that admin, change their password and sign them out of all devices.",
        relatedType: "USER",
        relatedId: adminId,
        idempotencyKey: `payment-pin-locked:${adminId}:${next.lockedUntil!.getTime()}`,
      });
      return { ok: false, status: 423, code: "PIN_LOCKED", error: lockedMessage(next.lockedUntil!, now), lockedNow: true } as const;
    }
    return { ok: false, status: 403, code: "WRONG_PIN", error: wrongPinMessage(next.failedCount) } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 6, baseDelayMs: 25 });
  if (!verdict.ok && "lockedNow" in verdict) {
    await emailNotice(adminId, "locked");
    return { ok: false, status: verdict.status, code: verdict.code, error: verdict.error };
  }
  return verdict;
}

export type PinChangeResult = { status: number; body: Record<string, unknown> };

/**
 * Sets or changes the admin's own PIN. Always needs the login password; changing an existing PIN also needs the
 * current PIN (counted like any other try). The admin is told by email and in the app either way.
 */
export async function setPaymentPin(adminId: string, input: { currentPassword?: unknown; currentPin?: unknown; newPin?: unknown }): Promise<PinChangeResult> {
  const admin = await activeAdmin(adminId);
  if (!admin) return { status: 403, body: { error: "Admin access required." } };
  const rule = checkNewPin(input.newPin);
  if (!rule.ok) return { status: 400, body: { error: rule.error, code: "WEAK_PIN" } };
  const passwordOk = typeof input.currentPassword === "string" && input.currentPassword.length > 0 && input.currentPassword.length <= 200
    && admin.passwordHash !== null && await bcrypt.compare(input.currentPassword, admin.passwordHash);
  if (!passwordOk) return { status: 400, body: { error: "That isn’t your current password. Check it and try again.", code: "WRONG_PASSWORD" } };

  const existing = await db.adminPaymentPin.findUnique({ where: { userId: adminId }, select: { userId: true } });
  if (existing) {
    const check = await verifyPaymentPin(adminId, input.currentPin, "changing the PIN");
    if (!check.ok) return { status: check.status, body: { error: check.code === "PIN_REQUIRED" ? "Enter your current payment PIN." : check.error, code: check.code } };
  }
  const pinHash = await bcrypt.hash(input.newPin as string, PIN_COST);
  const kind = existing ? "changed" : "set";
  await db.$transaction(async (tx) => {
    await tx.adminPaymentPin.upsert({
      where: { userId: adminId },
      create: { userId: adminId, pinHash },
      update: { pinHash, failedCount: 0, lockedUntil: null, setAt: new Date() },
    });
    await writeAuditLog(tx, { actorId: adminId, action: `payment_pin.${kind}`, resource: "AdminPaymentPin", resourceId: adminId, details: `Admin ${kind} their payment PIN.` });
    await createNotification(tx, {
      userId: adminId,
      type: "SYSTEM",
      title: kind === "set" ? "Payment PIN set" : "Payment PIN changed",
      message: "Your payment PIN was just updated. If this wasn’t you, change your password and sign out of all devices straight away.",
      idempotencyKey: `payment-pin-${kind}:${adminId}:${Date.now()}`,
    });
  });
  await emailNotice(adminId, kind);
  return { status: 200, body: { message: kind === "set" ? "Payment PIN set. You’ll need it to confirm or reject transfers." : "Payment PIN changed." } };
}

/**
 * Another admin forgot their PIN: an admin removes it with their OWN PIN, and the other admin then sets a new one
 * (which needs their password). Nobody can reset their own PIN this way.
 */
export async function resetPaymentPin(actorId: string, actorPin: unknown, targetUserId: unknown): Promise<PinChangeResult> {
  if (typeof targetUserId !== "string" || !targetUserId || targetUserId.length > 100) return { status: 400, body: { error: "Choose an admin." } };
  if (targetUserId === actorId) return { status: 400, body: { error: "You can’t reset your own PIN. Change it with your current PIN, or ask another admin to reset it." } };
  const [actor, target] = await Promise.all([activeAdmin(actorId), db.user.findFirst({ where: { id: targetUserId, role: "ADMIN" }, select: { id: true } })]);
  if (!actor) return { status: 403, body: { error: "Admin access required." } };
  if (!target) return { status: 404, body: { error: "Admin not found." } };
  const check = await verifyPaymentPin(actorId, actorPin, "resetting another admin's PIN");
  if (!check.ok) return { status: check.status, body: { error: check.error, code: check.code } };
  const removed = await db.$transaction(async (tx) => {
    const deleted = await tx.adminPaymentPin.deleteMany({ where: { userId: targetUserId } });
    if (deleted.count !== 1) return false;
    await writeAuditLog(tx, { actorId, action: "payment_pin.reset", resource: "AdminPaymentPin", resourceId: targetUserId, details: "Admin reset another admin’s payment PIN." });
    await createNotification(tx, {
      userId: targetUserId,
      type: "SYSTEM",
      title: "Payment PIN reset",
      message: "Another admin reset your payment PIN. Set a new one on the Payments page before confirming or rejecting transfers.",
      idempotencyKey: `payment-pin-reset:${targetUserId}:${Date.now()}`,
    });
    return true;
  });
  if (!removed) return { status: 409, body: { error: "That admin has no payment PIN to reset." } };
  await emailNotice(targetUserId, "reset");
  return { status: 200, body: { message: "PIN reset. They’ll need to set a new one before confirming or rejecting transfers." } };
}
