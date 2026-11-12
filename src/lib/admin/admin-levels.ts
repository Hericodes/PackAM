/**
 * Admin levels. A super admin is an ADMIN account whose email is listed in SUPER_ADMIN_EMAILS (a Vercel environment
 * variable, so no email is ever written in the code). Super admins can open everything, and only they can:
 * - see Finance, Analytics and the Audit log;
 * - make other accounts admins, or remove them (Admin → Admins).
 * Every other ADMIN is a normal admin: orders, payments, catalogue, food, runners, prices, promo codes, emails and
 * support, but not the pages above.
 *
 * Until SUPER_ADMIN_EMAILS is set, levels are off: every admin keeps the access they had before (everything), but
 * nobody can add or remove admins from the app, since nobody is known to be the owner yet.
 *
 * Pure (the list is passed in), so every rule is unit-tested; src/lib/admin/admin-access.ts reads the environment.
 */

export type AdminLevel = "super" | "admin";

/** Pages (and everything under them) only a super admin may open. Their APIs check the same rule. */
export const SUPER_ADMIN_PATHS = ["/admin/finance", "/admin/analytics", "/admin/audit", "/admin/admins"] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a@x.com, B@Y.com" → ["a@x.com", "b@y.com"]. Commas, semicolons or spaces separate; anything not an email is ignored. */
export function parseSuperAdminEmails(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  return [...new Set(raw.split(/[\s,;]+/).map((part) => part.trim().toLowerCase()).filter((part) => EMAIL.test(part)))];
}

/** Whether admin levels are switched on (at least one super admin is configured). */
export function adminLevelsConfigured(superEmails: readonly string[]) {
  return superEmails.length > 0;
}

/** The level of an ADMIN account with this email. With no super admin configured, every admin is treated as one. */
export function adminLevelFor(email: string | null | undefined, superEmails: readonly string[]): AdminLevel {
  if (!adminLevelsConfigured(superEmails)) return "super";
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return normalized && superEmails.includes(normalized) ? "super" : "admin";
}

/** Whether this email is a configured super admin (never true while levels are off). */
export function isConfiguredSuperAdmin(email: string | null | undefined, superEmails: readonly string[]) {
  return adminLevelsConfigured(superEmails) && adminLevelFor(email, superEmails) === "super";
}

export function isSuperAdminPath(pathname: string) {
  return SUPER_ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`) || pathname.startsWith(`${path}#`) || pathname.startsWith(`${path}?`));
}

/** Whether an admin of this level may open the page. */
export function canOpenAdminPath(level: AdminLevel, pathname: string) {
  return level === "super" || !isSuperAdminPath(pathname);
}

/** Adding and removing admins needs a configured super admin (never while levels are off). */
export function canManageAdmins(level: AdminLevel, superEmails: readonly string[]) {
  return level === "super" && adminLevelsConfigured(superEmails);
}

/** The roles an admin can be turned back into. */
export const DEMOTION_ROLES = ["STUDENT", "RUNNER"] as const;
export type DemotionRole = (typeof DEMOTION_ROLES)[number];

export function parseDemotionRole(value: unknown): DemotionRole | null {
  return value === "STUDENT" || value === "RUNNER" ? value : null;
}
