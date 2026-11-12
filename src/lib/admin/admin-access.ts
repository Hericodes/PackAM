import "server-only";

import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { requireRole } from "../auth-guard";
import { db } from "../db";
import { adminLevelFor, adminLevelsConfigured, canManageAdmins, parseSuperAdminEmails, type AdminLevel } from "./admin-levels";

/** The configured super admins (SUPER_ADMIN_EMAILS), lowercased. Empty while admin levels are off. */
export function superAdminEmails(env: Record<string, string | undefined> = process.env) {
  return parseSuperAdminEmails(env.SUPER_ADMIN_EMAILS);
}

export type AdminAccess = { userId: string; email: string; level: AdminLevel; configured: boolean; canManageAdmins: boolean };

async function accessFor(user: { id: string; email?: string | null }): Promise<AdminAccess> {
  const emails = superAdminEmails();
  // The session carries the email (re-read from the database on every request); without one, read it here.
  const email = user.email ?? (await db.user.findUnique({ where: { id: user.id }, select: { email: true } }))?.email ?? "";
  const level = adminLevelFor(email, emails);
  return { userId: user.id, email, level, configured: adminLevelsConfigured(emails), canManageAdmins: canManageAdmins(level, emails) };
}

/**
 * Admin pages: the signed-in admin and their level. The session's email is re-read from the database on every
 * request (src/auth.ts), so a changed email or role counts straight away.
 */
export async function requireAdminAccess(returnTo?: string): Promise<AdminAccess> {
  const session = await requireRole("ADMIN", returnTo);
  // requireRole lets admins through every role's pages; here only an actual admin is allowed.
  if (session.user.role !== "ADMIN") redirect("/unauthorized");
  return await accessFor({ id: session.user.id, email: session.user.email });
}

/** Super admin pages (Finance, Analytics, Audit log, Admins). A normal admin is sent to the overview with a note. */
export async function requireSuperAdminPage(returnTo?: string): Promise<AdminAccess> {
  const access = await requireAdminAccess(returnTo);
  if (access.level !== "super") redirect("/admin?restricted=1");
  return access;
}

/** For API routes: the admin's access, or the response to return (401, or 403 when `superOnly` and not a super admin). */
export async function adminApiAccess(options: { superOnly?: boolean } = {}): Promise<{ ok: true; access: AdminAccess } | { ok: false; response: Response }> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
  if (session.user.role !== "ADMIN") return { ok: false, response: Response.json({ error: "Admin access required." }, { status: 403 }) };
  const access = await accessFor({ id: session.user.id, email: session.user.email });
  if (options.superOnly && access.level !== "super") return { ok: false, response: Response.json({ error: "Only the super admin can do this.", code: "SUPER_ADMIN_ONLY" }, { status: 403 }) };
  return { ok: true, access };
}
