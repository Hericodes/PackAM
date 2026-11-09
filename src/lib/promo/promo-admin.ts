import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { writeAuditLog } from "../audit";
import { PROMO_CODE_MIGRATION, isSchemaBehindCode } from "../db-errors";
import { PROMO_PAID_STATUSES, notePromoSchemaMissing, promoTablesReady } from "./promo-store";
import { adminPromoRow, type AdminPromoRow, type NewPromoCode } from "./promo-admin-input";

/**
 * Admin → Promo codes on the server: the list (with paid uses) and the two writes, create and pause/resume. Codes are
 * never edited or deleted after creation, so what students were offered stays on record. Works on a database without
 * migration 20261109090000: the page then explains and every write is refused before anything is written.
 */

export const PROMO_CODES_NOT_READY = {
  error: `Promo codes activate after the database update (migration ${PROMO_CODE_MIGRATION} is pending). Nothing was changed.`,
  code: "PROMO_CODES_NOT_READY",
} as const;

export type ActionResult = { status: number; body: Record<string, unknown> };

const AUDIT_RESOURCE = "PromoCode";
export const PROMO_AUDIT_ACTIONS = { created: "PROMO_CODE_CREATED", paused: "PROMO_CODE_PAUSED", resumed: "PROMO_CODE_RESUMED" } as const;
const LIST_SIZE = 100;

export type PromoAdminView = { ready: boolean; codes: AdminPromoRow[] };

export async function loadPromoAdminView(now: Date = new Date()): Promise<PromoAdminView> {
  if (!(await promoTablesReady(db))) return { ready: false, codes: [] };
  try {
    const codes = await db.promoCode.findMany({
      orderBy: { createdAt: "desc" },
      take: LIST_SIZE,
      select: {
        id: true, code: true, type: true, value: true, maxDiscount: true, minSubtotal: true, maxUses: true, maxUsesPerStudent: true,
        startsAt: true, endsAt: true, active: true, createdAt: true,
        createdBy: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    // Paid checkouts only: an abandoned or failed attempt never counts as a use.
    const usage = codes.length
      ? await db.promoRedemption.groupBy({
        by: ["promoCodeId"],
        where: { promoCodeId: { in: codes.map((code) => code.id) }, payment: { status: { in: [...PROMO_PAID_STATUSES] } } },
        _count: { _all: true },
        _sum: { discount: true },
      })
      : [];
    const byCode = new Map(usage.map((entry) => [entry.promoCodeId, { uses: entry._count._all, discountGiven: entry._sum.discount ?? 0 }]));
    return {
      ready: true,
      codes: codes.map((code) => adminPromoRow({
        ...code,
        createdByName: [code.createdBy.firstName, code.createdBy.lastName].filter(Boolean).join(" ") || code.createdBy.email,
        uses: byCode.get(code.id)?.uses ?? 0,
        discountGiven: byCode.get(code.id)?.discountGiven ?? 0,
      }, now)),
    };
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    notePromoSchemaMissing(error, "admin list");
    return { ready: false, codes: [] };
  }
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Creates a code for `adminId`, with an audit row in the same transaction. A code that already exists is refused. */
export async function createPromoCode(adminId: string, input: NewPromoCode): Promise<ActionResult> {
  if (!(await promoTablesReady(db))) return { status: 503, body: { ...PROMO_CODES_NOT_READY } };
  try {
    const created = await db.$transaction(async (tx) => {
      const code = await tx.promoCode.create({ data: { ...input, createdById: adminId }, select: { id: true, code: true } });
      await writeAuditLog(tx, {
        actorId: adminId,
        action: PROMO_AUDIT_ACTIONS.created,
        resource: AUDIT_RESOURCE,
        resourceId: code.id,
        newState: { ...input, startsAt: input.startsAt?.toISOString() ?? null, endsAt: input.endsAt?.toISOString() ?? null },
      });
      return code;
    });
    return { status: 201, body: { promoCode: created } };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 409, body: { error: `${input.code} already exists. Choose another code.`, code: "PROMO_CODE_TAKEN", fields: { code: "This code already exists." } } };
    if (isSchemaBehindCode(error)) {
      notePromoSchemaMissing(error, "admin create");
      return { status: 503, body: { ...PROMO_CODES_NOT_READY } };
    }
    throw error;
  }
}

/** Pauses or resumes a code. Payments already started with a paused code still complete. Saving the same state writes nothing. */
export async function setPromoCodeActive(adminId: string, id: string, active: boolean): Promise<ActionResult> {
  if (!(await promoTablesReady(db))) return { status: 503, body: { ...PROMO_CODES_NOT_READY } };
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.promoCode.findUnique({ where: { id }, select: { id: true, code: true, active: true } });
      if (!current) return { status: 404, body: { error: "That promo code no longer exists.", code: "PROMO_CODE_NOT_FOUND" } };
      if (current.active === active) return { status: 200, body: { promoCode: current, changed: false } };
      const updated = await tx.promoCode.update({ where: { id }, data: { active }, select: { id: true, code: true, active: true } });
      await writeAuditLog(tx, {
        actorId: adminId,
        action: active ? PROMO_AUDIT_ACTIONS.resumed : PROMO_AUDIT_ACTIONS.paused,
        resource: AUDIT_RESOURCE,
        resourceId: id,
        previousState: { code: current.code, active: current.active },
        newState: { code: current.code, active },
      });
      return { status: 200, body: { promoCode: updated, changed: true } };
    });
  } catch (error) {
    if (isSchemaBehindCode(error)) {
      notePromoSchemaMissing(error, "admin pause");
      return { status: 503, body: { ...PROMO_CODES_NOT_READY } };
    }
    throw error;
  }
}
