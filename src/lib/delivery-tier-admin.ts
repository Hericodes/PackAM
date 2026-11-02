import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { writeAuditLog } from "./audit";
import { retrySerializable } from "./db-retry";
import { DELIVERY_TIER_MIGRATION, isSchemaBehindCode } from "./db-errors";
import { deliveryTierTablesReady, noteTierSchemaMissing, readTierTables } from "./delivery-tier-store";
import { DELIVERY_TIER_LABELS } from "./delivery-tiers";
import {
  adminTierCards, adminTierHistoryEntry, applyTierSettingChange, describeTierChange, isCheckViolation, isWriteConflict,
  type AdminTierCard, type AdminTierHistoryEntry, type AdminTierRow, type TierSettingChange,
} from "./delivery-tier-admin-input";

/**
 * Admin → Delivery tiers on the server: the page's data and the one write, a tier's fee and/or on/off switch.
 * Works on a database without migration 20261101150000: the page then shows Cruise Mode only and explains, and
 * every edit is refused before anything is written. The rules themselves are pure (delivery-tier-admin-input.ts).
 */

export const DELIVERY_TIERS_NOT_READY = {
  error: `Delivery tier pricing activates after the database update (migration ${DELIVERY_TIER_MIGRATION} is pending). Nothing was changed.`,
  code: "DELIVERY_TIERS_NOT_READY",
} as const;

export type ActionResult = { status: number; body: Record<string, unknown> };

/** Every change is one AuditLog row with this action: the admin (actorId), the time (createdAt) and the before and after. */
export const DELIVERY_TIER_AUDIT_ACTION = "DELIVERY_TIER_UPDATED";
const AUDIT_RESOURCE = "DeliveryTierSetting";
const HISTORY_SIZE = 20;

const ROW_SELECT = { tier: true, fee: true, enabled: true, etaMinMinutes: true, etaMaxMinutes: true, version: true, updatedAt: true } as const;

export type DeliveryTierAdminView = {
  /** False until the tier tables exist: the cards then show the Cruise-only fallback and can't be edited. */
  ready: boolean;
  tiers: AdminTierCard[];
  /** The latest changes, newest first. */
  history: AdminTierHistoryEntry[];
};

export async function loadDeliveryTierAdminView(): Promise<DeliveryTierAdminView> {
  const [rows, audits] = await Promise.all([
    readTierTables<typeof db, AdminTierRow[] | null>(db, (client) => client.deliveryTierSetting.findMany({ select: ROW_SELECT }), null, "admin page"),
    // AuditLog exists with or without the tier migration.
    db.auditLog.findMany({
      where: { action: DELIVERY_TIER_AUDIT_ACTION, resource: AUDIT_RESOURCE },
      orderBy: { createdAt: "desc" },
      take: HISTORY_SIZE,
      select: { id: true, resourceId: true, previousState: true, newState: true, createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } },
    }),
  ]);
  return { ready: rows !== null, tiers: adminTierCards(rows), history: audits.map(adminTierHistoryEntry) };
}

function tierChanged(): ActionResult {
  return { status: 409, body: { error: "Someone changed this tier while you were editing it. The page now shows the latest values.", code: "TIER_CHANGED" } };
}

/**
 * Changes one tier's fee and/or switch for `adminId`, made against the row's `version` (optimistic concurrency).
 * Serializable and retried on conflicts, so two admins turning off different tiers at once can never leave every tier
 * off (the second one re-reads and is refused). A save that changes nothing writes nothing: no audit row, no version.
 * Never creates a row. Refusals come back as { status, body: { error, code } } with nothing written.
 */
export async function updateDeliveryTierSetting(adminId: string, change: TierSettingChange): Promise<ActionResult> {
  if (!(await deliveryTierTablesReady(db))) return { status: 503, body: { ...DELIVERY_TIERS_NOT_READY } };
  try {
    return await retrySerializable(() => serializableAttempt(adminId, change), { attempts: 5, baseDelayMs: 25 });
  } catch (error) {
    // The transaction rolled back, so nothing was written in either case.
    if (isSchemaBehindCode(error)) {
      noteTierSchemaMissing(error, "admin update");
      return { status: 503, body: { ...DELIVERY_TIERS_NOT_READY } };
    }
    if (isCheckViolation(error)) {
      return { status: 400, body: { error: "The database refused this setting, so nothing was changed. Check the fee and try again.", code: "INVALID_TIER_SETTING" } };
    }
    throw error;
  }
}

/**
 * One serializable attempt. Every write conflict leaves it with P2034, the code retrySerializable retries: a conflict
 * found when COMMIT runs comes back from Prisma as the adapter's raw error without that code (see isWriteConflict).
 */
async function serializableAttempt(adminId: string, change: TierSettingChange): Promise<ActionResult> {
  try {
    return await db.$transaction((tx) => applyChange(tx, adminId, change), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isWriteConflict(error) && (error as { code?: unknown }).code !== "P2034") {
      throw Object.assign(new Error("The transaction hit a write conflict when it committed. Nothing was saved."), { name: "TransactionWriteConflict", code: "P2034", cause: error });
    }
    throw error;
  }
}

async function applyChange(tx: Prisma.TransactionClient, adminId: string, change: TierSettingChange): Promise<ActionResult> {
  const rows = await tx.deliveryTierSetting.findMany({ select: ROW_SELECT });
  const row = rows.find((candidate) => candidate.tier === change.tier);
  if (!row) return { status: 404, body: { error: `${DELIVERY_TIER_LABELS[change.tier]} isn’t set up in this database, so it can’t be changed here. Nothing was changed.`, code: "TIER_NOT_FOUND" } };
  if (row.version !== change.version) return tierChanged();

  const decision = applyTierSettingChange(row, change, rows.filter((other) => other.tier !== change.tier));
  if (!decision.ok) return { status: decision.status, body: { error: decision.error, code: decision.code } };
  if (!decision.changed) return { status: 200, body: { tier: row, changed: false } };

  const next = { fee: decision.next.fee, enabled: decision.next.enabled };
  const updated = await tx.deliveryTierSetting.updateMany({
    where: { tier: change.tier, version: row.version },
    data: { fee: next.fee, enabled: next.enabled, version: { increment: 1 } },
  });
  if (updated.count !== 1) return tierChanged();
  await writeAuditLog(tx, {
    actorId: adminId,
    action: DELIVERY_TIER_AUDIT_ACTION,
    resource: AUDIT_RESOURCE,
    resourceId: change.tier,
    previousState: { fee: row.fee, enabled: row.enabled },
    newState: next,
    details: describeTierChange(change.tier, row, next),
  });
  const saved = await tx.deliveryTierSetting.findUniqueOrThrow({ where: { tier: change.tier }, select: ROW_SELECT });
  return { status: 200, body: { tier: saved, changed: true } };
}
