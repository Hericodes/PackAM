import bcrypt from "bcryptjs";

import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { isSchemaBehindCode, accountSchemaBehindResponse } from "../../../../lib/db-errors";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

/**
 * Signs the account out on other devices: { action: "others" | "all", currentPassword }. Session cookies can't be
 * listed one by one (they are stateless), so both bump the account's session version, which ends every session.
 * "others": this browser then signs straight back in with the password just typed (reauth: true), so only the
 * other devices stay signed out. "all": this browser signs out too. 10 attempts an hour per account.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return signInRequired();
  const rate = await consumeRateLimit(`account-sessions:${userId}`, 10, 60 * 60 * 1000);
  if (!rate.allowed) {
    return Response.json({ error: "Too many attempts. Please wait a while, then try again.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const body = await readJsonObject(request);
  const action = body?.action;
  if (action !== "others" && action !== "all") {
    return Response.json({ error: "Choose which devices to sign out, then try again.", code: "INVALID_REQUEST" }, { status: 400 });
  }

  try {
    const user = await db.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true, passwordHash: true } });
    if (!user) return signInRequired();
    if (!(await currentPasswordMatches(body?.currentPassword, user.passwordHash))) {
      return Response.json({ error: "That isn’t your current password. Check it and try again.", code: "WRONG_PASSWORD" }, { status: 400 });
    }
    const revoked = await db.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({ where: { id: user.id, status: "ACTIVE" }, data: { sessionVersion: { increment: 1 } } });
      if (updated.count !== 1) return false;
      await writeAuditLog(tx, {
        actorId: user.id,
        action: "ACCOUNT_SESSIONS_REVOKED",
        resource: "User",
        resourceId: user.id,
        newState: { scope: action },
        details: action === "others" ? "Signed out of other devices; this device signs in again." : "Signed out on every device.",
      });
      return true;
    });
    if (!revoked) return signInRequired();
    return Response.json({ ok: true, reauth: action === "others" });
  } catch (error) {
    if (isSchemaBehindCode(error)) return accountSchemaBehindResponse(error, "POST /api/account/sessions");
    console.error("ACCOUNT SESSIONS ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t sign out your devices. Nothing has changed. Please try again." }, { status: 500 });
  }
}

function signInRequired() {
  return Response.json({ error: "Sign in to manage your devices.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
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
