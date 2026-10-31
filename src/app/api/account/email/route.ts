import bcrypt from "bcryptjs";

import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { afterResponse } from "../../../../lib/after-response";
import { AppUrlConfigError, appUrl } from "../../../../lib/app-url";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../../lib/db-errors";
import { isEmailConfigured, sendEmail } from "../../../../lib/email";
import { confirmEmailChange, emailChangeRequestedNotice } from "../../../../lib/email/templates";
import { TOKEN_TTL_MS, findPendingEmailChange, issueAccountToken, revokeAccountTokens } from "../../../../lib/account/account-tokens";
import { isValidEmail, maskEmail, normaliseEmail } from "../../../../lib/account/validation";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

/**
 * Starts an email change for the signed-in person: { newEmail, currentPassword }. The current email keeps working
 * until the new one is confirmed from the link emailed to it (GET /api/account/email/confirm); the current address
 * gets a notice showing the new one masked. Asking again replaces the earlier link. 5 requests an hour per account,
 * wrong passwords included. Answers { pendingEmail, pendingEmailExpiresAt, status: "sent" }.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return signInRequired();
  if (!emailLinksAvailable()) {
    return Response.json({ error: "PackAM can’t send emails right now, so your email can’t be changed yet. Please try again later.", code: "EMAIL_NOT_CONFIGURED" }, { status: 503 });
  }
  const rate = await consumeRateLimit(`account-email-change:${userId}`, 5, 60 * 60 * 1000);
  if (!rate.allowed) {
    return Response.json({ error: "You’ve asked to change your email a few times already. Please wait a while, then try again.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const body = await readJsonObject(request);
  if (!body) return invalidRequest();
  const newEmail = normaliseEmail(body.newEmail);
  if (!isValidEmail(newEmail)) return Response.json({ error: "Enter a valid email address, like name@example.com.", code: "INVALID_EMAIL" }, { status: 400 });

  try {
    const user = await db.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true, email: true, firstName: true, passwordHash: true } });
    if (!user) return signInRequired();
    if (newEmail === user.email) return Response.json({ error: "That’s already your email address.", code: "SAME_EMAIL" }, { status: 400 });
    // The password comes before anything that says whether another account uses the address.
    if (!(await currentPasswordMatches(body.currentPassword, user.passwordHash))) return wrongPassword();
    const taken = await db.user.findFirst({ where: { email: newEmail }, select: { id: true } });
    if (taken) return Response.json({ error: "Another PackAM account already uses that email.", code: "EMAIL_TAKEN" }, { status: 409 });

    const now = new Date();
    const token = await db.$transaction(async (tx) => {
      const active = await tx.user.findFirst({ where: { id: user.id, status: "ACTIVE" }, select: { id: true } });
      if (!active) return null;
      // Marks any earlier change link used, so only this one works.
      const issued = await issueAccountToken(tx, { userId: user.id, purpose: "EMAIL_CHANGE", email: newEmail, now });
      await writeAuditLog(tx, {
        actorId: user.id,
        action: "ACCOUNT_EMAIL_CHANGE_REQUESTED",
        resource: "User",
        resourceId: user.id,
        details: "Confirmation link sent to the new address; the current address stays in use until it is confirmed.",
      });
      return issued;
    });
    if (!token) return signInRequired();

    const link = appUrl(`/api/account/email/confirm?token=${token}`);
    await afterResponse(async () => {
      await sendEmail({ to: newEmail, purpose: "email-change", ...confirmEmailChange(user.firstName, link, newEmail) });
    });
    await afterResponse(async () => {
      await sendEmail({ to: user.email, purpose: "email-change-requested", ...emailChangeRequestedNotice(user.firstName, maskEmail(newEmail)) });
    });
    return Response.json({ pendingEmail: newEmail, pendingEmailExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS.EMAIL_CHANGE), status: "sent" });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "POST /api/account/email");
    console.error("ACCOUNT EMAIL CHANGE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t start your email change. Nothing has changed. Please try again." }, { status: 500 });
  }
}

/** Cancels a pending email change: its link stops working. Answers { ok: true, cancelled } (false when none was pending). */
export async function DELETE(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return signInRequired();

  try {
    const cancelled = await db.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true } });
      if (!user) return null;
      const pending = await findPendingEmailChange(tx, user.id);
      await revokeAccountTokens(tx, { userId: user.id, purpose: "EMAIL_CHANGE" });
      if (pending) await writeAuditLog(tx, { actorId: user.id, action: "ACCOUNT_EMAIL_CHANGE_CANCELLED", resource: "User", resourceId: user.id });
      return pending !== null;
    });
    if (cancelled === null) return signInRequired();
    return Response.json({ ok: true, cancelled });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "DELETE /api/account/email");
    console.error("ACCOUNT EMAIL CANCEL ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t cancel your email change. Please try again." }, { status: 500 });
  }
}

function signInRequired() {
  return Response.json({ error: "Sign in to manage your account.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
}

function invalidRequest() {
  return Response.json({ error: "PackAM couldn’t read that request. Refresh the page and try again.", code: "INVALID_REQUEST" }, { status: 400 });
}

function wrongPassword() {
  return Response.json({ error: "That isn’t your current password. Check it and try again.", code: "WRONG_PASSWORD" }, { status: 400 });
}

/** The current password exactly as typed: never trimmed or policy-checked, since older passwords weren't held to either. */
async function currentPasswordMatches(password: unknown, hash: string | null) {
  if (typeof password !== "string" || !password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/** Email can be sent and its links built. */
function emailLinksAvailable() {
  if (!isEmailConfigured()) return false;
  try {
    appUrl("/");
    return true;
  } catch (error) {
    if (!(error instanceof AppUrlConfigError)) throw error;
    console.error("ACCOUNT EMAIL LINKS UNAVAILABLE:", error.name);
    return false;
  }
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
