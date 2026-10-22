import { timingSafeEqual } from "node:crypto";

/**
 * Authorization for scheduled jobs. One secret, CRON_SECRET, is used by every caller: Vercel Cron sends
 * it automatically as `Authorization: Bearer <CRON_SECRET>`, and the GitHub Actions schedule sends the
 * same header. Pure, so it is unit-tested.
 */
export const CRON_SECRET_MIN_LENGTH = 16;

export function cronSecretConfigured(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.trim().length >= CRON_SECRET_MIN_LENGTH;
}

/** Constant-time comparison of the bearer token with CRON_SECRET; false whenever anything is missing. */
export function isAuthorizedCronRequest(authorization: string | null | undefined, secret: string | undefined) {
  if (!cronSecretConfigured(secret) || !authorization) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;
  const supplied = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(secret.trim(), "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
