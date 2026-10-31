import bcrypt from "bcryptjs";

import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { afterResponse } from "../../../../lib/after-response";
import { isSchemaBehindCode, accountSchemaBehindResponse } from "../../../../lib/db-errors";
import { sendEmail } from "../../../../lib/email";
import { passwordChangedNotice } from "../../../../lib/email/templates";
import { revokeAccountTokens } from "../../../../lib/account/account-tokens";
import { passwordProblem } from "../../../../lib/account/password-policy";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

/**
 * Changes the signed-in person's password: { currentPassword, newPassword }. The current password is checked
 * exactly as typed; the new one must pass the password policy. Every device is signed out (session version bump),
 * including this one, which signs straight back in with the new password (hence reauth: true). Password-reset
 * links and a pending email change made before this stop working, and the account's email gets a notice.
 * 10 attempts an hour per account, wrong passwords included.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return signInRequired();
  const rate = await consumeRateLimit(`account-password:${userId}`, 10, 60 * 60 * 1000);
  if (!rate.allowed) {
    return Response.json({ error: "Too many attempts. Please wait a while, then try again.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "PackAM couldn’t read that request. Refresh the page and try again.", code: "INVALID_REQUEST" }, { status: 400 });

  try {
    const user = await db.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true } });
    if (!user) return signInRequired();
    if (!(await currentPasswordMatches(body.currentPassword, user.passwordHash))) {
      return Response.json({ error: "That isn’t your current password. Check it and try again.", code: "WRONG_PASSWORD" }, { status: 400 });
    }
    const names = [user.firstName, user.lastName].filter((name): name is string => Boolean(name));
    const problem = passwordProblem(body.newPassword, { email: user.email, names });
    if (problem || typeof body.newPassword !== "string") {
      return Response.json({ error: problem ?? "Enter a password.", code: "WEAK_PASSWORD" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    const now = new Date();
    const changed = await db.$transaction(async (tx) => {
      // Only over the password just checked: a reset or another device changing it meanwhile is never overwritten.
      const updated = await tx.user.updateMany({
        where: { id: user.id, status: "ACTIVE", passwordHash: user.passwordHash },
        data: { passwordHash, passwordChangedAt: now, sessionVersion: { increment: 1 } },
      });
      if (updated.count !== 1) return false;
      // Links sent before this password (a reset, an email change someone else may have asked for) stop working.
      await revokeAccountTokens(tx, { userId: user.id, purpose: "PASSWORD_RESET", now });
      await revokeAccountTokens(tx, { userId: user.id, purpose: "EMAIL_CHANGE", now });
      await writeAuditLog(tx, {
        actorId: user.id,
        action: "ACCOUNT_PASSWORD_CHANGED",
        resource: "User",
        resourceId: user.id,
        details: "Password changed in settings; every device was signed out.",
      });
      return true;
    });
    if (!changed) {
      return Response.json({ error: "Your password was changed somewhere else just now. Sign in again, then try again.", code: "ACCOUNT_CHANGED" }, { status: 409 });
    }

    await afterResponse(async () => {
      await sendEmail({ to: user.email, purpose: "password-changed", ...passwordChangedNotice(user.firstName) });
    });
    return Response.json({ ok: true, reauth: true });
  } catch (error) {
    if (isSchemaBehindCode(error)) return accountSchemaBehindResponse(error, "POST /api/account/password");
    console.error("ACCOUNT PASSWORD ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t change your password. Nothing has changed. Please try again." }, { status: 500 });
  }
}

function signInRequired() {
  return Response.json({ error: "Sign in to change your password.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
}

/** The current password exactly as typed: never trimmed or policy-checked, since older passwords weren't held to either. */
async function currentPasswordMatches(password: unknown, hash: string | null) {
  if (typeof password !== "string" || !password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/** The JSON body when it is an object, otherwise null. */
async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
