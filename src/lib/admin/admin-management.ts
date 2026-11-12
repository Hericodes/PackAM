import "server-only";

import { db } from "../db";
import { writeAuditLog } from "../audit";
import { createNotification } from "../notifications";
import { isValidEmail } from "../account/validation";
import { isConfiguredSuperAdmin, parseDemotionRole } from "./admin-levels";
import { superAdminEmails, type AdminAccess } from "./admin-access";

export type AdminTeamMember = { id: string; name: string; email: string; phone: string | null; isSuper: boolean; delivering: boolean };
export type ManagementResult = { status: number; body: Record<string, unknown> };

/** Orders and print jobs still on their way: an admin can't be removed while delivering one. */
const ACTIVE_ORDER_STATUSES = ["RUNNER_ASSIGNED", "SOURCING_PRODUCT", "OUT_FOR_DELIVERY"] as const;
const ACTIVE_PRINT_STATUSES = ["RUNNER_ASSIGNED", "DOCUMENT_RECEIVED", "PRINTING", "PRINTED", "OUT_FOR_DELIVERY"] as const;

const fullName = (user: { firstName: string | null; lastName: string | null; email: string }) => [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

/** Every admin account, super admins first. */
export async function listAdminTeam(): Promise<AdminTeamMember[]> {
  const supers = superAdminEmails();
  const admins = await db.user.findMany({
    where: { role: "ADMIN" },
    orderBy: [{ firstName: "asc" }, { email: "asc" }],
    take: 200,
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, runnerProfile: { select: { isAvailable: true } } },
  });
  return admins
    .map((admin) => ({ id: admin.id, name: fullName(admin), email: admin.email, phone: admin.phone, isSuper: isConfiguredSuperAdmin(admin.email, supers), delivering: Boolean(admin.runnerProfile?.isAvailable) }))
    .sort((a, b) => Number(b.isSuper) - Number(a.isSuper));
}

/**
 * Makes an existing account an admin. They must have signed up already; suspended or deleted accounts can't be
 * promoted. Logged, and the person is told in their notifications.
 */
export async function promoteToAdmin(actor: AdminAccess, rawEmail: unknown): Promise<ManagementResult> {
  if (!actor.canManageAdmins) return { status: 403, body: { error: "Only the super admin can add admins." } };
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !isValidEmail(email)) return { status: 400, body: { error: "Enter the email address they use for PackAM." } };

  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email }, select: { id: true, role: true, status: true, firstName: true, lastName: true, email: true } });
    if (!user) return { status: 404, body: { error: "No PackAM account uses that email. Ask them to sign up first, then try again." } };
    if (user.status !== "ACTIVE") return { status: 409, body: { error: "That account is suspended or deleted, so it can’t be made an admin." } };
    if (user.role === "ADMIN") return { status: 409, body: { error: `${fullName(user)} is already an admin.` } };

    await tx.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    await writeAuditLog(tx, { actorId: actor.userId, action: "admin.added", resource: "User", resourceId: user.id, previousState: { role: user.role }, newState: { role: "ADMIN" }, details: `Made ${user.email} an admin.` });
    await createNotification(tx, {
      userId: user.id,
      type: "ACCOUNT",
      title: "You’re now a PackAM admin",
      message: "You can open the admin dashboard from your account. Your old orders and settings are still here.",
      idempotencyKey: `admin-added:${user.id}:${Date.now()}`,
    });
    return { status: 200, body: { admin: { id: user.id, name: fullName(user), email: user.email } } };
  });
}

/**
 * Removes an admin: back to a student or runner account. Never the super admin (set in SUPER_ADMIN_EMAILS), never
 * yourself, and never while they are delivering an order or print job.
 */
export async function removeAdmin(actor: AdminAccess, rawUserId: unknown, rawRole: unknown): Promise<ManagementResult> {
  if (!actor.canManageAdmins) return { status: 403, body: { error: "Only the super admin can remove admins." } };
  const userId = typeof rawUserId === "string" && rawUserId.length <= 100 ? rawUserId : "";
  const role = parseDemotionRole(rawRole);
  if (!userId || !role) return { status: 400, body: { error: "Choose who to remove, and whether they go back to a student or runner account." } };
  if (userId === actor.userId) return { status: 409, body: { error: "You can’t remove yourself." } };

  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true, role: true, email: true, firstName: true, lastName: true,
        runnerProfile: {
          select: {
            id: true,
            assignedOrders: { where: { status: { in: [...ACTIVE_ORDER_STATUSES] } }, select: { id: true }, take: 1 },
            assignedPrintJobs: { where: { status: { in: [...ACTIVE_PRINT_STATUSES] } }, select: { id: true }, take: 1 },
          },
        },
      },
    });
    if (!user || user.role !== "ADMIN") return { status: 404, body: { error: "That person isn’t an admin any more." } };
    if (isConfiguredSuperAdmin(user.email, superAdminEmails())) return { status: 409, body: { error: "The super admin is set in Vercel (SUPER_ADMIN_EMAILS), so they can’t be removed here." } };
    if (user.runnerProfile && (user.runnerProfile.assignedOrders.length || user.runnerProfile.assignedPrintJobs.length)) {
      return { status: 409, body: { error: `${fullName(user)} is delivering an order right now. Remove them after it’s delivered.` } };
    }

    await tx.user.update({ where: { id: user.id }, data: { role } });
    // Back to a student: they stop getting delivery offers. Back to a runner: their availability is theirs to set.
    if (role === "STUDENT" && user.runnerProfile) await tx.runnerProfile.update({ where: { id: user.runnerProfile.id }, data: { isAvailable: false } });
    await writeAuditLog(tx, { actorId: actor.userId, action: "admin.removed", resource: "User", resourceId: user.id, previousState: { role: "ADMIN" }, newState: { role }, details: `Removed ${user.email} as admin (now a ${role.toLowerCase()}).` });
    await createNotification(tx, {
      userId: user.id,
      type: "ACCOUNT",
      title: "You’re no longer a PackAM admin",
      message: role === "RUNNER" ? "Your account is a runner account again." : "Your account is a student account again. You can keep ordering as usual.",
      idempotencyKey: `admin-removed:${user.id}:${Date.now()}`,
    });
    return { status: 200, body: { removed: { id: user.id, role } } };
  });
}
