import "server-only";

import { db } from "../db";
import { writeAuditLog } from "../audit";
import { EMAIL_CAMPAIGN_MIGRATION, isSchemaBehindCode } from "../db-errors";
import { orderingHoursFromEnv } from "../ordering-hours";
import { consumeRateLimit } from "../rate-limit";
import { isEmailConfigured, sendEmail } from "./index";
import { unsubscribeSecretConfigured } from "./unsubscribe";
import { EMAIL_KIND_SCOPE, EMAIL_SCOPE_LABELS, campusDayKey, windowStartLabel, type BroadcastInput, type EmailKindCode } from "./campaign-rules";
import { emailTablesReady, noteEmailSchemaMissing } from "./campaign-store";
import { countAudience, renderCampaignEmail } from "./campaigns";

/**
 * Admin → Emails on the server: the page's data, the on/off switches for the scheduled emails and order updates,
 * announcements (create, cancel) and test emails to the admin's own inbox. Every change is audited. Works on a
 * database without migration 20261110090000: the page then explains and every write is refused.
 */

export const EMAILS_NOT_READY = {
  error: `Automated email activates after the database update (migration ${EMAIL_CAMPAIGN_MIGRATION} is pending). Nothing was changed.`,
  code: "EMAILS_NOT_READY",
} as const;

export type ActionResult = { status: number; body: Record<string, unknown> };
export type SwitchableKind = "MORNING" | "REMINDER" | "ORDER_UPDATE";
const SWITCHABLE: SwitchableKind[] = ["MORNING", "REMINDER", "ORDER_UPDATE"];
const DEFAULT_ENABLED: Record<SwitchableKind, boolean> = { MORNING: false, REMINDER: false, ORDER_UPDATE: true };

type Counts = { sent: number; failed: number; waiting: number; skipped: number };

export type EmailAdminView = {
  ready: boolean;
  configured: boolean;
  secretConfigured: boolean;
  switches: Array<{ kind: SwitchableKind; title: string; when: string; enabled: boolean; today: Counts; audience: number | null }>;
  announcementAudience: number;
  broadcasts: Array<{ id: string; subject: string; status: string; recipientCount: number; createdAt: Date; finishedAt: Date | null; createdByName: string; counts: Counts }>;
};

function emptyCounts(): Counts {
  return { sent: 0, failed: 0, waiting: 0, skipped: 0 };
}

function addCount(counts: Counts, status: string, n: number) {
  if (status === "SENT") counts.sent += n;
  else if (status === "FAILED") counts.failed += n;
  else if (status === "SKIPPED") counts.skipped += n;
  else counts.waiting += n;
}

export async function loadEmailAdminView(now: Date = new Date()): Promise<EmailAdminView> {
  const configured = isEmailConfigured();
  const secretConfigured = unsubscribeSecretConfigured(process.env.AUTH_SECRET);
  const hours = orderingHoursFromEnv();
  const describe = (kind: SwitchableKind) => {
    if (kind === "ORDER_UPDATE") return "When an order is confirmed, assigned, on the way, delivered or refunded";
    const start = windowStartLabel(kind, hours);
    if (!start) return "Doesn’t apply to the current ordering hours";
    return kind === "MORNING" ? `${start} on ordering days, before ordering opens` : `${start} on ordering days, to students who haven’t ordered that day`;
  };
  const notReady: EmailAdminView = {
    ready: false, configured, secretConfigured, announcementAudience: 0, broadcasts: [],
    switches: SWITCHABLE.map((kind) => ({ kind, title: EMAIL_SCOPE_LABELS[EMAIL_KIND_SCOPE[kind]].title, when: describe(kind), enabled: false, today: emptyCounts(), audience: null })),
  };
  if (!(await emailTablesReady(db))) return notReady;
  try {
    const day = campusDayKey(now);
    const startOfDay = new Date(`${day}T00:00:00+01:00`);
    const [schedules, todayGroups, broadcasts] = await Promise.all([
      db.emailSchedule.findMany({ select: { kind: true, enabled: true } }),
      db.emailDelivery.groupBy({ by: ["kind", "status"], where: { OR: [{ kind: { in: ["MORNING", "REMINDER"] }, key: day }, { kind: "ORDER_UPDATE", createdAt: { gte: startOfDay } }] }, _count: { _all: true } }),
      db.emailBroadcast.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, subject: true, status: true, recipientCount: true, createdAt: true, finishedAt: true, createdBy: { select: { firstName: true, lastName: true, email: true } } } }),
    ]);
    const broadcastGroups = broadcasts.length
      ? await db.emailDelivery.groupBy({ by: ["key", "status"], where: { kind: "ANNOUNCEMENT", key: { in: broadcasts.map((b) => b.id) } }, _count: { _all: true } })
      : [];
    const enabled = new Map(schedules.map((row) => [row.kind, row.enabled]));
    const today = new Map<string, Counts>();
    for (const group of todayGroups) {
      const counts = today.get(group.kind) ?? emptyCounts();
      addCount(counts, group.status, group._count._all);
      today.set(group.kind, counts);
    }
    const perBroadcast = new Map<string, Counts>();
    for (const group of broadcastGroups) {
      const counts = perBroadcast.get(group.key) ?? emptyCounts();
      addCount(counts, group.status, group._count._all);
      perBroadcast.set(group.key, counts);
    }
    const [morningAudience, reminderAudience, announcementAudience] = await Promise.all([
      countAudience("MORNING", day, now),
      countAudience("REMINDER", day, now),
      countAudience("ANNOUNCEMENT", "preview-audience", now),
    ]);
    return {
      ready: true,
      configured,
      secretConfigured,
      announcementAudience,
      switches: SWITCHABLE.map((kind) => ({
        kind,
        title: EMAIL_SCOPE_LABELS[EMAIL_KIND_SCOPE[kind]].title,
        when: describe(kind),
        enabled: enabled.get(kind) ?? DEFAULT_ENABLED[kind],
        today: today.get(kind) ?? emptyCounts(),
        audience: kind === "MORNING" ? morningAudience : kind === "REMINDER" ? reminderAudience : null,
      })),
      broadcasts: broadcasts.map((broadcast) => ({
        id: broadcast.id,
        subject: broadcast.subject,
        status: broadcast.status,
        recipientCount: broadcast.recipientCount,
        createdAt: broadcast.createdAt,
        finishedAt: broadcast.finishedAt,
        createdByName: [broadcast.createdBy.firstName, broadcast.createdBy.lastName].filter(Boolean).join(" ") || broadcast.createdBy.email,
        counts: perBroadcast.get(broadcast.id) ?? emptyCounts(),
      })),
    };
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    noteEmailSchemaMissing(error, "admin view");
    return notReady;
  }
}

async function guarded(where: string, work: () => Promise<ActionResult>): Promise<ActionResult> {
  if (!(await emailTablesReady(db))) return { status: 503, body: { ...EMAILS_NOT_READY } };
  try {
    return await work();
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    noteEmailSchemaMissing(error, where);
    return { status: 503, body: { ...EMAILS_NOT_READY } };
  }
}

/** Turns a scheduled email or order updates on or off for everyone. */
export function setEmailSchedule(adminId: string, kind: SwitchableKind, enabled: boolean): Promise<ActionResult> {
  return guarded("admin switch", () => db.$transaction(async (tx) => {
    const before = await tx.emailSchedule.findUnique({ where: { kind }, select: { enabled: true } });
    const was = before?.enabled ?? DEFAULT_ENABLED[kind];
    if (was === enabled && before) return { status: 200, body: { kind, enabled, changed: false } };
    await tx.emailSchedule.upsert({ where: { kind }, create: { kind, enabled, updatedById: adminId }, update: { enabled, updatedById: adminId } });
    await writeAuditLog(tx, { actorId: adminId, action: "EMAIL_SCHEDULE_UPDATED", resource: "EmailSchedule", resourceId: kind, previousState: { enabled: was }, newState: { enabled } });
    return { status: 200, body: { kind, enabled, changed: was !== enabled } };
  }));
}

/** Starts an announcement: the scheduler sends it to every subscribed student in batches, starting within 5 minutes. */
export function createBroadcast(adminId: string, input: BroadcastInput): Promise<ActionResult> {
  return guarded("admin announce", async () => {
    const recipientCount = await countAudience("ANNOUNCEMENT", "preview-audience");
    if (!recipientCount) return { status: 409, body: { error: "No student can receive announcements yet (no active student has them switched on). Nothing was sent.", code: "NO_RECIPIENTS" } };
    const broadcast = await db.$transaction(async (tx) => {
      const created = await tx.emailBroadcast.create({ data: { ...input, recipientCount, createdById: adminId, status: "SENDING" }, select: { id: true, subject: true, recipientCount: true } });
      await writeAuditLog(tx, { actorId: adminId, action: "EMAIL_BROADCAST_CREATED", resource: "EmailBroadcast", resourceId: created.id, newState: { subject: input.subject, recipientCount, hasButton: Boolean(input.buttonUrl) } });
      return created;
    });
    return { status: 201, body: { broadcast } };
  });
}

/** Stops an announcement that is still sending. Emails already sent stay sent. */
export function cancelBroadcast(adminId: string, id: string): Promise<ActionResult> {
  return guarded("admin cancel", () => db.$transaction(async (tx) => {
    const current = await tx.emailBroadcast.findUnique({ where: { id }, select: { status: true } });
    if (!current) return { status: 404, body: { error: "That announcement no longer exists.", code: "BROADCAST_NOT_FOUND" } };
    if (current.status !== "SENDING") return { status: 409, body: { error: "That announcement has already finished.", code: "BROADCAST_FINISHED" } };
    await tx.emailBroadcast.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
    const skipped = await tx.emailDelivery.updateMany({ where: { kind: "ANNOUNCEMENT", key: id, status: "PENDING" }, data: { status: "SKIPPED" } });
    await writeAuditLog(tx, { actorId: adminId, action: "EMAIL_BROADCAST_CANCELLED", resource: "EmailBroadcast", resourceId: id, previousState: { status: "SENDING" }, newState: { status: "CANCELLED", skipped: skipped.count } });
    return { status: 200, body: { cancelled: true } };
  }));
}

/**
 * Sends one email of `kind` to the admin's own inbox, exactly as students get it (with the admin's own unsubscribe
 * link). For ANNOUNCEMENT pass the draft. At most 10 test emails per admin per hour.
 */
export async function sendCampaignTest(adminId: string, kind: EmailKindCode, draft?: BroadcastInput): Promise<ActionResult> {
  if (!isEmailConfigured()) return { status: 503, body: { error: "Email isn’t set up on this server (RESEND_API_KEY and EMAIL_FROM).", code: "EMAIL_NOT_CONFIGURED" } };
  if (!unsubscribeSecretConfigured(process.env.AUTH_SECRET)) return { status: 503, body: { error: "AUTH_SECRET is missing, so unsubscribe links can’t be made.", code: "UNSUBSCRIBE_NOT_CONFIGURED" } };
  const rate = await consumeRateLimit(`email-test:${adminId}`, 10, 60 * 60_000);
  if (!rate.allowed) return { status: 429, body: { error: "That’s enough test emails for now. Try again in a while.", code: "RATE_LIMITED" } };
  const admin = await db.user.findUnique({ where: { id: adminId }, select: { id: true, email: true, firstName: true, emailVerifiedAt: true } });
  if (!admin) return { status: 404, body: { error: "Your account wasn’t found." } };
  const sample = kind === "ORDER_UPDATE" ? { orderId: "cmsampleorder00example", title: "On the way", message: "Your package dey road 🛵 Keep your phone close." } : undefined;
  const rendered = renderCampaignEmail(kind, { id: admin.id, firstName: admin.firstName }, { now: new Date(), hours: orderingHoursFromEnv(), broadcast: draft, payload: sample });
  if (!rendered) return { status: 400, body: { error: "Write the announcement first." } };
  const result = await sendEmail({ to: admin.email, ...rendered.email, subject: `[Test] ${rendered.email.subject}`, purpose: `email-test-${kind.toLowerCase()}`, toConfirmedAddress: Boolean(admin.emailVerifiedAt), headers: rendered.headers });
  if (result.status !== "sent") return { status: 502, body: { error: "The test email couldn’t be sent. Try again shortly.", code: "TEST_NOT_SENT" } };
  return { status: 200, body: { sentTo: admin.email } };
}
