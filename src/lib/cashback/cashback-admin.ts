import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { writeAuditLog } from "../audit";
import { retrySerializable } from "../db-retry";
import { createNotification } from "../notifications";
import { parseCashbackAdjustment, parseCashbackSettingsInput } from "./cashback-rules";
import { CASHBACK_MIGRATION, cashbackBalance, cashbackTablesReady, readCashbackSettings, readStudentCashback } from "./cashback-store";

export type CashbackAdminResult = { status: number; body: Record<string, unknown> };

const NOT_READY: CashbackAdminResult = { status: 503, body: { error: `Cashback isn’t set up on this database yet (migration ${CASHBACK_MIGRATION}).`, code: "CASHBACK_NOT_MIGRATED" } };
const naira = (amount: number) => `₦${Math.abs(amount).toLocaleString("en-NG")}`;

/** Admin → Cashback: switch earning on or off, the % back and the welcome bonus. Logged. */
export async function updateCashbackSettings(adminId: string, raw: unknown): Promise<CashbackAdminResult> {
  const parsed = parseCashbackSettingsInput(raw);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  if (!(await cashbackTablesReady(db))) return NOT_READY;
  return db.$transaction(async (tx) => {
    const before = await readCashbackSettings(tx);
    const saved = await tx.cashbackSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...parsed.data, updatedById: adminId },
      update: { ...parsed.data, updatedById: adminId },
      select: { enabled: true, ratePercent: true, welcomeBonus: true },
    });
    await writeAuditLog(tx, { actorId: adminId, action: "cashback.settings_updated", resource: "CashbackSettings", resourceId: "default", previousState: before, newState: saved });
    return { status: 200, body: { settings: saved } };
  });
}

/** One student's balance and recent history, for the admin lookup. */
export async function studentCashbackForAdmin(studentId: string): Promise<CashbackAdminResult> {
  if (!studentId || studentId.length > 100) return { status: 400, body: { error: "Choose a student." } };
  const student = await db.user.findFirst({ where: { id: studentId, role: "STUDENT" }, select: { id: true, firstName: true, lastName: true, email: true } });
  if (!student) return { status: 404, body: { error: "That student wasn’t found." } };
  const cashback = await readStudentCashback(db, student.id, 25);
  if (!cashback.ready) return NOT_READY;
  return { status: 200, body: { student: { id: student.id, name: [student.firstName, student.lastName].filter(Boolean).join(" ") || student.email, email: student.email }, balance: cashback.balance, entries: cashback.entries } };
}

/**
 * Adds or takes away cashback for one student, with a reason they see. Taking away never goes below ₦0. Serializable,
 * so it can't race a checkout spending the same balance. Logged and the student is told.
 */
export async function adjustCashback(adminId: string, studentId: string, raw: unknown): Promise<CashbackAdminResult> {
  const parsed = parseCashbackAdjustment(raw);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  if (!studentId || studentId.length > 100) return { status: 400, body: { error: "Choose a student." } };
  if (!(await cashbackTablesReady(db))) return NOT_READY;
  const { amount, note } = parsed.data;
  return retrySerializable(() => db.$transaction(async (tx) => {
    const student = await tx.user.findFirst({ where: { id: studentId, role: "STUDENT", status: "ACTIVE" }, select: { id: true, email: true } });
    if (!student) return { status: 404, body: { error: "That student account isn’t active." } };
    const balance = await cashbackBalance(tx, student.id);
    if (balance + amount < 0) return { status: 409, body: { error: `They only have ${naira(balance)}, so you can take away at most that.` } };
    const entry = await tx.cashbackEntry.create({ data: { userId: student.id, kind: "ADJUSTMENT", amount, key: `adjust:${randomUUID()}`, actorId: adminId, note }, select: { id: true } });
    await writeAuditLog(tx, { actorId: adminId, action: "cashback.adjusted", resource: "User", resourceId: student.id, previousState: { balance }, newState: { balance: balance + amount, amount }, details: `${amount > 0 ? "Added" : "Took away"} ${naira(amount)} cashback for ${student.email}: ${note}` });
    await createNotification(tx, {
      userId: student.id,
      type: "PAYMENT",
      title: amount > 0 ? `${naira(amount)} cashback from PackAM 🎉` : "Your cashback changed",
      message: amount > 0 ? `${note}. It’s in your cashback, ready for your next order.` : `PackAM took ${naira(amount)} from your cashback: ${note}.`,
      relatedType: "CASHBACK",
      idempotencyKey: `cashback-adjust:${entry.id}`,
    });
    return { status: 200, body: { balance: balance + amount } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 4, baseDelayMs: 25 });
}
