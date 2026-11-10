/**
 * Rules for automated email: which kinds exist, when each scheduled one may go out, the rotating good-morning copy,
 * and checking an admin's announcement. Pure (time and ordering hours are passed in), so every rule is unit-tested.
 *
 * The scheduled emails follow the ordering hours (src/lib/ordering-hours.ts), so changing ORDERING_HOURS or
 * ORDERING_DAYS moves them too. On ordering days only (Monday to Friday by default):
 * - MORNING: from 30 minutes before ordering opens (7:30am) until 90 minutes after (9:30am).
 * - REMINDER: from 90 minutes before ordering closes (3:30pm) until 15 minutes before (4:45pm), and only to students
 *   who haven't ordered that day.
 * The scheduler runs every 5 minutes and sends in batches, so everyone gets theirs inside the window; whatever is
 * left when a window ends is skipped (a "good morning" at lunchtime would be wrong).
 */
import type { OrderingHours, Weekday } from "../ordering-hours";

/** The kinds a student can switch on and off (the EmailPreference columns). Safe in the browser. */
export const EMAIL_SCOPES = ["morning", "reminders", "announcements", "orderUpdates"] as const;
export type EmailScope = (typeof EMAIL_SCOPES)[number];

export type EmailKindCode = "MORNING" | "REMINDER" | "ANNOUNCEMENT" | "ORDER_UPDATE";

export const EMAIL_KIND_SCOPE: Record<EmailKindCode, EmailScope> = {
  MORNING: "morning",
  REMINDER: "reminders",
  ANNOUNCEMENT: "announcements",
  ORDER_UPDATE: "orderUpdates",
};

/** What students and admins call each kind. */
export const EMAIL_SCOPE_LABELS: Record<EmailScope, { title: string; description: string; noun: string }> = {
  morning: { title: "Good morning message", description: "Weekday mornings, before ordering opens.", noun: "good-morning emails" },
  reminders: { title: "Order reminder", description: "Weekday afternoons, before ordering closes, if you haven’t ordered that day.", noun: "order reminders" },
  announcements: { title: "News and offers", description: "New shops, promo codes and PackAM news.", noun: "news and offers" },
  orderUpdates: { title: "Order updates", description: "Confirmed, runner on the way, delivered and refunds.", noun: "order update emails" },
};

const CAMPUS_OFFSET_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;
/** 1 January 1970 was a Thursday. */
const EPOCH_WEEKDAY = 4;

function campusParts(now: Date) {
  const campusMs = now.getTime() + CAMPUS_OFFSET_MS;
  const day = Math.floor(campusMs / DAY_MS);
  return { day, minute: (campusMs - day * DAY_MS) / MINUTE_MS, weekday: ((day + EPOCH_WEEKDAY) % 7) as Weekday };
}

/** "2026-11-10": the campus day, used as the send key so each student gets each scheduled email once a day. */
export function campusDayKey(now: Date) {
  return new Date(campusParts(now).day * DAY_MS).toISOString().slice(0, 10);
}

/** Campus midnight at the start of `now`'s campus day (for "hasn't ordered today"). */
export function campusDayStart(now: Date) {
  return new Date(campusParts(now).day * DAY_MS - CAMPUS_OFFSET_MS);
}

export type ScheduledKind = "MORNING" | "REMINDER";

/** The window [startMinute, endMinute) after campus midnight for a scheduled email, or null when it can't apply. */
export function sendWindow(kind: ScheduledKind, hours: OrderingHours): { startMinute: number; endMinute: number } | null {
  if (kind === "MORNING") {
    if (hours.opensAtMinute < 30) return null; // opens at midnight (all day): no morning before opening
    return { startMinute: hours.opensAtMinute - 30, endMinute: Math.min(hours.opensAtMinute + 90, hours.closesAtMinute) };
  }
  const startMinute = hours.closesAtMinute - 90;
  const endMinute = hours.closesAtMinute - 15;
  if (hours.closesAtMinute >= 24 * 60 || startMinute <= hours.opensAtMinute) return null; // never closes, or too short a day
  return { startMinute, endMinute };
}

/** True while a scheduled email may be sent: an ordering day, inside its window. */
export function inSendWindow(kind: ScheduledKind, hours: OrderingHours, now: Date) {
  const window = sendWindow(kind, hours);
  if (!window) return false;
  const { minute, weekday } = campusParts(now);
  return hours.days.includes(weekday) && minute >= window.startMinute && minute < window.endMinute;
}

/** "7:30am" for the admin page. */
export function windowStartLabel(kind: ScheduledKind, hours: OrderingHours) {
  const window = sendWindow(kind, hours);
  if (!window) return null;
  const hour24 = Math.floor(window.startMinute / 60);
  const minutes = window.startMinute % 60;
  return `${hour24 % 12 === 0 ? 12 : hour24 % 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${hour24 < 12 ? "am" : "pm"}`;
}

/** Good-morning copy, in PackAM's voice. One a day for everyone, rotating by date. */
export const MORNING_MESSAGES = [
  { subject: "Good morning! ☀️ Wetin dey sup today?", heading: "Good morning! ☀️", line: "Wetin dey sup? Whatever you need today, food, provisions or printing, PackAM go bring am come meet you on campus." },
  { subject: "Rise and shine ☀️ PackAM dey open soon", heading: "Rise and shine! ☀️", line: "Before the day carry you go, sort your breakfast or lunch with PackAM. We go handle the waka." },
  { subject: "Good morning ☀️ No stress today", heading: "No stress today 😌", line: "Lecture, assignment, hostel matter… we know the day full. Let PackAM run the errands while you face your own." },
  { subject: "Morning o ☀️ Wetin you wan collect?", heading: "Morning o! ☀️", line: "Hungry? Need provisions? Assignment wan print? Just pick am for PackAM and relax, we dey come sharp sharp." },
  { subject: "Good morning ☀️ Make today easy", heading: "Make today easy ☀️", line: "From food to prints, PackAM brings it to you anywhere on OOU main campus. Oya, wetin we fit run for you today?" },
] as const;

export function morningMessage(now: Date) {
  return MORNING_MESSAGES[campusParts(now).day % MORNING_MESSAGES.length];
}

export const BROADCAST_LIMITS = { subject: 120, body: 5000, buttonLabel: 40, buttonUrl: 500 } as const;

export type BroadcastInput = { subject: string; body: string; buttonLabel: string | null; buttonUrl: string | null };

/** Checks an admin's announcement. The button is optional, but needs both a label and an https link. */
export function parseBroadcastInput(raw: unknown): { ok: true; data: BroadcastInput } | { ok: false; field: keyof BroadcastInput | null; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, field: null, error: "Invalid request." };
  const input = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "");
  const subject = text(input.subject).replace(/\s+/g, " ");
  const body = text(input.body);
  const buttonLabel = text(input.buttonLabel).replace(/\s+/g, " ");
  const buttonUrl = text(input.buttonUrl);
  if (!subject) return { ok: false, field: "subject", error: "Write a subject." };
  if (subject.length > BROADCAST_LIMITS.subject) return { ok: false, field: "subject", error: `Keep the subject to ${BROADCAST_LIMITS.subject} characters.` };
  if (!body) return { ok: false, field: "body", error: "Write the message." };
  if (body.length > BROADCAST_LIMITS.body) return { ok: false, field: "body", error: `Keep the message to ${BROADCAST_LIMITS.body} characters.` };
  if (Boolean(buttonLabel) !== Boolean(buttonUrl)) return { ok: false, field: buttonLabel ? "buttonUrl" : "buttonLabel", error: "A button needs both a label and a link, or leave both empty." };
  if (buttonLabel.length > BROADCAST_LIMITS.buttonLabel) return { ok: false, field: "buttonLabel", error: `Keep the button label to ${BROADCAST_LIMITS.buttonLabel} characters.` };
  if (buttonUrl) {
    let url: URL | null = null;
    try { url = new URL(buttonUrl); } catch { /* reported below */ }
    if (!url || url.protocol !== "https:" || buttonUrl.length > BROADCAST_LIMITS.buttonUrl) return { ok: false, field: "buttonUrl", error: "The button link must be a full https:// address." };
  }
  return { ok: true, data: { subject, body, buttonLabel: buttonLabel || null, buttonUrl: buttonUrl || null } };
}

/** An announcement's message as paragraphs: split on blank lines, single line breaks kept as spaces. */
export function bodyParagraphs(body: string) {
  return body.split(/\n\s*\n/).map((part) => part.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
}
