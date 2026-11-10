/**
 * The only code outside the scheduler that reads or writes the automated email tables (EmailPreference,
 * EmailSchedule, EmailBroadcast, EmailDelivery). Everything here works on a database without migration
 * 20261110090000_email_campaigns: preferences read as "all on" (nothing is sent anyway), saving refuses, and order
 * updates simply aren't queued.
 *
 * - A probe (to_regclass) runs first. It never fails, so it can't abort a transaction. Only "ready" is remembered.
 * - Inside a transaction, writes run in a savepoint (tx.$transaction), so a failure rolls back only the savepoint.
 *
 * Takes the client as an argument and imports neither db nor server-only, so the fallbacks are unit-tested.
 */
import type { Prisma } from "@prisma/client";
import { EMAIL_CAMPAIGN_MIGRATION, isSchemaBehindCode, missingSchemaElement } from "../db-errors";
import { isSerializationFailure } from "../db-retry";
import type { EmailScope } from "./unsubscribe";

type Tx = Prisma.TransactionClient;
type ProbeClient = Pick<Tx, "$queryRaw">;

let tablesReady = false;
let reportedMissing = false;

function reportMissingOnce(what: string) {
  if (reportedMissing) return;
  reportedMissing = true;
  console.error(`SCHEMA BEHIND CODE in automated email: the database is missing ${what}. No automated email is sent until migration ${EMAIL_CAMPAIGN_MIGRATION} is applied (npx prisma migrate deploy).`);
}

/** True once the email tables exist. Safe inside a transaction: to_regclass returns NULL instead of failing. */
export async function emailTablesReady(client: ProbeClient): Promise<boolean> {
  if (tablesReady) return true;
  const rows = await client.$queryRaw<Array<{ ready: boolean | null }>>`SELECT (to_regclass('public."EmailPreference"') IS NOT NULL AND to_regclass('public."EmailDelivery"') IS NOT NULL AND to_regclass('public."EmailSchedule"') IS NOT NULL AND to_regclass('public."EmailBroadcast"') IS NOT NULL) AS "ready"`;
  tablesReady = rows[0]?.ready === true;
  if (!tablesReady) reportMissingOnce("the automated email tables");
  return tablesReady;
}

/** An email query hit schema lag although the probe said ready: probe again next time. */
export function noteEmailSchemaMissing(error: unknown, where: string) {
  tablesReady = false;
  reportMissingOnce(`${missingSchemaElement(error)} (${where})`);
}

/** Tests only: forget the probe result and the log-once flag. */
export function resetEmailProbe() {
  tablesReady = false;
  reportedMissing = false;
}

export type EmailPreferences = Record<EmailScope, boolean>;

/** No row = everything on (the owner's choice), with an unsubscribe link in every email. */
export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = { morning: true, reminders: true, announcements: true, orderUpdates: true };

const PREFERENCE_SELECT = { morning: true, reminders: true, announcements: true, orderUpdates: true } as const;

/** A student's choices. `ready` is false before the migration (the settings page then shows the old text). */
export async function readEmailPreferences(client: ProbeClient & Pick<Tx, "emailPreference">, userId: string): Promise<{ ready: boolean; preferences: EmailPreferences }> {
  if (!(await emailTablesReady(client))) return { ready: false, preferences: { ...DEFAULT_EMAIL_PREFERENCES } };
  try {
    const row = await client.emailPreference.findUnique({ where: { userId }, select: PREFERENCE_SELECT });
    return { ready: true, preferences: { ...DEFAULT_EMAIL_PREFERENCES, ...(row ?? {}) } };
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    noteEmailSchemaMissing(error, "read preferences");
    return { ready: false, preferences: { ...DEFAULT_EMAIL_PREFERENCES } };
  }
}

/** Saves some of a student's choices (the rest keep their value). Null before the migration: nothing was saved. */
export async function updateEmailPreferences(client: ProbeClient & Pick<Tx, "emailPreference">, userId: string, change: Partial<EmailPreferences>): Promise<EmailPreferences | null> {
  if (!(await emailTablesReady(client))) return null;
  try {
    const row = await client.emailPreference.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_EMAIL_PREFERENCES, ...change },
      update: change,
      select: PREFERENCE_SELECT,
    });
    return { ...DEFAULT_EMAIL_PREFERENCES, ...row };
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    noteEmailSchemaMissing(error, "save preferences");
    return null;
  }
}

/** The payload an ORDER_UPDATE delivery carries, frozen when the order event happened. */
export type OrderUpdatePayload = { orderId: string; title: string; message: string };

/**
 * Called by an order's status change, inside its transaction: queues the matching email for the scheduler to send.
 * It can never fail the order: it runs in a savepoint, and any error other than a serialization conflict (which the
 * order's own retry must see) is logged and swallowed. One email per order per title, so "Order confirmed" from two
 * statuses is sent once. The student's preference is checked when it is sent.
 */
export async function queueOrderUpdateEmail(tx: ProbeClient & Pick<Tx, "$transaction">, input: { userId: string; orderId: string; title: string; message: string }): Promise<boolean> {
  try {
    if (!(await emailTablesReady(tx))) return false;
    const payload: OrderUpdatePayload = { orderId: input.orderId, title: input.title.slice(0, 120), message: input.message.slice(0, 500) };
    await tx.$transaction((savepoint: Tx) => savepoint.emailDelivery.createMany({
      data: [{ userId: input.userId, kind: "ORDER_UPDATE", key: `order:${input.orderId}:${input.title}`.slice(0, 190), status: "PENDING", payload }],
      skipDuplicates: true,
    }));
    return true;
  } catch (error) {
    if (isSerializationFailure(error)) throw error;
    if (isSchemaBehindCode(error)) noteEmailSchemaMissing(error, "queue order update");
    else console.error("ORDER UPDATE EMAIL NOT QUEUED:", error instanceof Error ? error.name : "Unknown error");
    return false;
  }
}
