import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { appUrl } from "../app-url";
import { isSchemaBehindCode } from "../db-errors";
import { formatCampusClock, orderingHoursFromEnv, type OrderingHours } from "../ordering-hours";
import { shortReference } from "../student-copy";
import { EMAIL_BATCH_LIMIT, canDeliverTo, isEmailConfigured, sendEmailBatch, type BatchEmailMessage } from "./index";
import { announcementEmail, morningEmail, orderUpdateEmail, reminderEmail, type AutomatedFooter, type EmailContent } from "./templates";
import { signUnsubscribeToken, unsubscribeSecretConfigured, type EmailScope } from "./unsubscribe";
import { EMAIL_KIND_SCOPE, EMAIL_SCOPE_LABELS, bodyParagraphs, campusDayKey, campusDayStart, inSendWindow, morningMessage, type EmailKindCode, type ScheduledKind } from "./campaign-rules";
import { emailTablesReady, noteEmailSchemaMissing, type OrderUpdatePayload } from "./campaign-store";

/**
 * The automated email scheduler. runEmailCampaigns() is called every 5 minutes (after the dispatch pass, see
 * /api/internal/fulfilment/run-due) and does a bounded amount of work each time, in this order:
 *   1. order updates queued by order status changes (oldest first; dropped after 24 hours);
 *   2. the oldest announcement still sending;
 *   3. the good-morning email, inside its window on ordering days, if switched on;
 *   4. the order reminder, inside its window on ordering days, if switched on, to students who haven't ordered today.
 *
 * Every email is one EmailDelivery row, unique per (student, kind, key), claimed with FOR UPDATE SKIP LOCKED before it
 * is sent, so overlapping runs never send the same email twice. Recipients are active students with a confirmed
 * address whose preference for that kind is on (checked again just before sending). A failed provider call is retried
 * on the next runs (up to 3 tries); a row stuck mid-send is marked failed rather than risk a second copy.
 */

const MAX_EMAILS_PER_RUN = 300;
const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 15 * 60_000;
const ORDER_UPDATE_MAX_AGE_MS = 24 * 60 * 60_000;

/** Default switch when a schedule row is missing: scheduled emails off, order updates on (as the migration seeds). */
const DEFAULT_ENABLED: Record<Exclude<EmailKindCode, "ANNOUNCEMENT">, boolean> = { MORNING: false, REMINDER: false, ORDER_UPDATE: true };

type StepReport = { sent: number; failed: number; skipped: number; retrying: number };
const emptyStep = (): StepReport => ({ sent: 0, failed: 0, skipped: 0, retrying: 0 });

export type CampaignRunReport =
  | { skipped: "not-migrated" | "email-not-configured" | "no-unsubscribe-secret" }
  | { orderUpdates: StepReport; announcement: (StepReport & { broadcastId: string; finished: boolean }) | null; morning: StepReport | null; reminder: StepReport | null };

export async function runEmailCampaigns(now: Date = new Date()): Promise<CampaignRunReport> {
  if (!(await emailTablesReady(db))) return { skipped: "not-migrated" };
  if (!isEmailConfigured()) return { skipped: "email-not-configured" };
  if (!unsubscribeSecretConfigured(process.env.AUTH_SECRET)) {
    console.error("AUTOMATED EMAIL: AUTH_SECRET is missing or too short, so unsubscribe links can't be signed; nothing was sent.");
    return { skipped: "no-unsubscribe-secret" };
  }
  try {
    const hours = orderingHoursFromEnv();
    await db.emailDelivery.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } }, data: { status: "FAILED", claimToken: null } });
    const switches = await loadSwitches();
    let budget = MAX_EMAILS_PER_RUN;

    // 1. Order updates.
    let orderUpdates = emptyStep();
    await db.emailDelivery.updateMany({ where: { kind: "ORDER_UPDATE", status: "PENDING", createdAt: { lt: new Date(now.getTime() - ORDER_UPDATE_MAX_AGE_MS) } }, data: { status: "SKIPPED" } });
    if (switches.ORDER_UPDATE) {
      orderUpdates = await sendClaimed("ORDER_UPDATE", null, budget, { now, hours });
      budget -= attempted(orderUpdates);
    } else {
      await db.emailDelivery.updateMany({ where: { kind: "ORDER_UPDATE", status: "PENDING" }, data: { status: "SKIPPED" } });
    }

    // 2. The oldest announcement still sending.
    let announcement: (StepReport & { broadcastId: string; finished: boolean }) | null = null;
    const broadcast = await db.emailBroadcast.findFirst({ where: { status: "SENDING" }, orderBy: { createdAt: "asc" }, select: { id: true, subject: true, body: true, buttonLabel: true, buttonUrl: true } });
    if (broadcast && budget > 0) {
      await enqueueAudience("ANNOUNCEMENT", broadcast.id, budget, now);
      const step = await sendClaimed("ANNOUNCEMENT", broadcast.id, budget, { now, hours, broadcast });
      budget -= attempted(step);
      const open = await db.emailDelivery.count({ where: { kind: "ANNOUNCEMENT", key: broadcast.id, status: { in: ["PENDING", "SENDING"] } } });
      const finished = open === 0 && (await countAudience("ANNOUNCEMENT", broadcast.id, now)) === 0;
      if (finished) await db.emailBroadcast.updateMany({ where: { id: broadcast.id, status: "SENDING" }, data: { status: "SENT", finishedAt: now } });
      announcement = { ...step, broadcastId: broadcast.id, finished };
    }

    // 3 and 4. The scheduled emails.
    const morning = await runScheduled("MORNING", switches.MORNING, budget, now, hours);
    budget -= morning ? attempted(morning) : 0;
    const reminder = await runScheduled("REMINDER", switches.REMINDER, budget, now, hours);
    return { orderUpdates, announcement, morning, reminder };
  } catch (error) {
    if (isSchemaBehindCode(error)) {
      noteEmailSchemaMissing(error, "scheduler");
      return { skipped: "not-migrated" };
    }
    throw error;
  }
}

const attempted = (step: StepReport) => step.sent + step.failed + step.retrying;

async function loadSwitches() {
  const rows = await db.emailSchedule.findMany({ select: { kind: true, enabled: true } });
  const enabled = new Map(rows.map((row) => [row.kind, row.enabled]));
  return {
    MORNING: enabled.get("MORNING") ?? DEFAULT_ENABLED.MORNING,
    REMINDER: enabled.get("REMINDER") ?? DEFAULT_ENABLED.REMINDER,
    ORDER_UPDATE: enabled.get("ORDER_UPDATE") ?? DEFAULT_ENABLED.ORDER_UPDATE,
  };
}

async function runScheduled(kind: ScheduledKind, enabled: boolean, budget: number, now: Date, hours: OrderingHours): Promise<StepReport | null> {
  const key = campusDayKey(now);
  const open = enabled && inSendWindow(kind, hours, now);
  // Outside its window (or switched off), whatever is still waiting is dropped: never a late "good morning".
  await db.emailDelivery.updateMany({ where: { kind, status: "PENDING", ...(open ? { NOT: { key } } : {}) }, data: { status: "SKIPPED" } });
  if (!open || budget <= 0) return null;
  await enqueueAudience(kind, key, budget, now);
  return sendClaimed(kind, key, budget, { now, hours });
}

/** Who should get `kind`: active students with a confirmed address, that kind on, and no email for this key yet. */
function audienceWhere(kind: Exclude<EmailKindCode, "ORDER_UPDATE">, key: string, now: Date): Prisma.UserWhereInput {
  const scope = EMAIL_KIND_SCOPE[kind];
  return {
    role: "STUDENT",
    status: "ACTIVE",
    emailVerifiedAt: { not: null },
    OR: [{ emailPreference: { is: null } }, { emailPreference: { is: { [scope]: true } } }],
    emailDeliveries: { none: { kind, key } },
    // The reminder only goes to students who haven't ordered today.
    ...(kind === "REMINDER" ? { orders: { none: { createdAt: { gte: campusDayStart(now) } } } } : {}),
  };
}

async function enqueueAudience(kind: Exclude<EmailKindCode, "ORDER_UPDATE">, key: string, limit: number, now: Date) {
  const users = await db.user.findMany({ where: audienceWhere(kind, key, now), orderBy: { id: "asc" }, take: limit, select: { id: true } });
  if (users.length) await db.emailDelivery.createMany({ data: users.map((user) => ({ userId: user.id, kind, key, status: "PENDING" as const })), skipDuplicates: true });
}

/** How many students would still get `kind` for `key` (the admin page's audience counts use it too). */
export function countAudience(kind: Exclude<EmailKindCode, "ORDER_UPDATE">, key: string, now: Date = new Date()) {
  return db.user.count({ where: audienceWhere(kind, key, now) });
}

type SendContext = { now: Date; hours: OrderingHours; broadcast?: { subject: string; body: string; buttonLabel: string | null; buttonUrl: string | null } };

/** Claims up to `limit` waiting rows for (kind, key), sends them in batches and records each outcome. */
async function sendClaimed(kind: EmailKindCode, key: string | null, limit: number, context: SendContext): Promise<StepReport> {
  const report = emptyStep();
  if (limit <= 0) return report;
  const token = randomUUID();
  const claimed = await db.$queryRaw<Array<{ id: string; userId: string; payload: unknown; attempts: number }>>`
    UPDATE "EmailDelivery" SET "status" = 'SENDING', "claimToken" = ${token}, "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "EmailDelivery"
      WHERE "kind" = ${kind}::"EmailKind" ${key === null ? Prisma.empty : Prisma.sql`AND "key" = ${key}`} AND "status" = 'PENDING'
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "userId", "payload", "attempts"`;
  if (!claimed.length) return report;

  const scope = EMAIL_KIND_SCOPE[kind];
  const users = await db.user.findMany({
    where: { id: { in: claimed.map((row) => row.userId) } },
    select: { id: true, email: true, firstName: true, role: true, status: true, emailVerifiedAt: true, emailPreference: { select: { [scope]: true } } },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  const ready: Array<{ deliveryId: string; attempts: number; message: BatchEmailMessage }> = [];
  const skip: string[] = [];
  for (const row of claimed) {
    const user = byId.get(row.userId);
    const preference = (user?.emailPreference as Record<string, boolean> | null | undefined)?.[scope];
    const content = user && user.role === "STUDENT" && user.status === "ACTIVE" && user.emailVerifiedAt && preference !== false && canDeliverTo(user.email)
      ? renderCampaignEmail(kind, { id: user.id, firstName: user.firstName }, { ...context, payload: row.payload })
      : null;
    if (!user || !content) { skip.push(row.id); continue; }
    ready.push({ deliveryId: row.id, attempts: row.attempts, message: { to: user.email, ...content.email, headers: content.headers } });
  }
  if (skip.length) {
    await db.emailDelivery.updateMany({ where: { id: { in: skip }, claimToken: token }, data: { status: "SKIPPED", claimToken: null } });
    report.skipped += skip.length;
  }

  for (let start = 0; start < ready.length; start += EMAIL_BATCH_LIMIT) {
    const chunk = ready.slice(start, start + EMAIL_BATCH_LIMIT);
    const result = await sendEmailBatch(chunk.map((entry) => entry.message), { purpose: `email-${kind.toLowerCase()}`, idempotencyKey: `packam-email:${token}:${start}` });
    if (result.status === "sent") {
      const sentAt = new Date();
      await db.$transaction(chunk.map((entry, index) => db.emailDelivery.update({ where: { id: entry.deliveryId }, data: { status: "SENT", sentAt, claimToken: null, providerMessageId: result.providerIds[index] ?? null } })));
      report.sent += chunk.length;
      continue;
    }
    // Not sent: try again on a later run (the attempt was already counted), or give up after MAX_ATTEMPTS.
    const retry = result.status === "not-configured" ? chunk : chunk.filter((entry) => entry.attempts < MAX_ATTEMPTS);
    const give = chunk.filter((entry) => !retry.includes(entry));
    if (retry.length) await db.emailDelivery.updateMany({ where: { id: { in: retry.map((entry) => entry.deliveryId) }, claimToken: token }, data: { status: "PENDING", claimToken: null } });
    if (give.length) await db.emailDelivery.updateMany({ where: { id: { in: give.map((entry) => entry.deliveryId) }, claimToken: token }, data: { status: "FAILED", claimToken: null } });
    report.retrying += retry.length;
    report.failed += give.length;
    // Leave the rest for the next run rather than hammer a failing provider.
    const rest = ready.slice(start + EMAIL_BATCH_LIMIT).map((entry) => entry.deliveryId);
    if (rest.length) await db.emailDelivery.updateMany({ where: { id: { in: rest }, claimToken: token }, data: { status: "PENDING", claimToken: null, attempts: { decrement: 1 } } });
    break;
  }
  return report;
}

/** The unsubscribe link for one student and one kind, and the headers mail apps use for one-tap unsubscribe. */
function unsubscribeParts(userId: string, scope: EmailScope) {
  const token = signUnsubscribeToken(process.env.AUTH_SECRET ?? "", userId, scope);
  const oneTap = appUrl(`/api/email/unsubscribe?t=${encodeURIComponent(token)}`);
  const footer: AutomatedFooter = { noun: EMAIL_SCOPE_LABELS[scope].noun, unsubscribeUrl: appUrl(`/email/unsubscribe?t=${encodeURIComponent(token)}`), manageUrl: appUrl("/settings#emails") };
  return { footer, headers: { "List-Unsubscribe": `<${oneTap}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
}

const hoursLabel = (hours: OrderingHours) => `${formatCampusClock(hours.opensAtMinute)} to ${formatCampusClock(hours.closesAtMinute)}`;

/**
 * One student's email of `kind`, with their own unsubscribe link. Null when there is nothing valid to send (e.g. an
 * order update whose payload is malformed). Also used for admins' test emails.
 */
export function renderCampaignEmail(
  kind: EmailKindCode,
  recipient: { id: string; firstName: string | null },
  context: SendContext & { payload?: unknown },
): { email: EmailContent; headers: Record<string, string> } | null {
  const { footer, headers } = unsubscribeParts(recipient.id, EMAIL_KIND_SCOPE[kind]);
  const name = recipient.firstName;
  if (kind === "MORNING") return { email: morningEmail(name, morningMessage(context.now), hoursLabel(context.hours), appUrl("/"), footer), headers };
  if (kind === "REMINDER") return { email: reminderEmail(name, formatCampusClock(context.hours.closesAtMinute), appUrl("/"), footer), headers };
  if (kind === "ANNOUNCEMENT") {
    if (!context.broadcast) return null;
    return { email: announcementEmail(name, { subject: context.broadcast.subject, paragraphs: bodyParagraphs(context.broadcast.body), buttonLabel: context.broadcast.buttonLabel, buttonUrl: context.broadcast.buttonUrl }, footer), headers };
  }
  const payload = context.payload as Partial<OrderUpdatePayload> | null | undefined;
  if (!payload || typeof payload.orderId !== "string" || typeof payload.title !== "string" || typeof payload.message !== "string") return null;
  return { email: orderUpdateEmail(name, { title: payload.title, message: payload.message, orderRef: shortReference(payload.orderId), orderUrl: appUrl(`/orders/${encodeURIComponent(payload.orderId)}`) }, footer), headers };
}
