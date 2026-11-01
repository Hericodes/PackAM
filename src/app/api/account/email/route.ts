import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";

import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { afterResponse } from "../../../../lib/after-response";
import { AppUrlConfigError, appUrl } from "../../../../lib/app-url";
import { isSchemaBehindCode, accountSchemaBehindResponse } from "../../../../lib/db-errors";
import { isEmailConfigured, sendEmail } from "../../../../lib/email";
import { confirmEmailChange, confirmedName, emailChangeRequestedNotice } from "../../../../lib/email/templates";
import { TOKEN_TTL_MS, findPendingEmailChange, issueAccountToken, revokeAccountTokens } from "../../../../lib/account/account-tokens";
import { canonicalEmailForLimits, isValidEmail, maskEmail, normaliseEmail } from "../../../../lib/account/validation";
import { clientAddress, consumeRateLimit } from "../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

const HOUR_MS = 60 * 60 * 1000;
/** Per account, wrong passwords and refusals included. */
const REQUESTS_PER_ACCOUNT_PER_HOUR = 5;
/**
 * Per network, every account on it together, counted before the address, password or "already in use" checks: one
 * person with many accounts can't send links to many outside inboxes, or keep asking which addresses have an account.
 */
const REQUESTS_PER_NETWORK_PER_HOUR = 20;
/** Confirmation links to one inbox, whichever accounts ask ("+tag" and Gmail dot variants count as one inbox). */
const LINKS_PER_INBOX_PER_HOUR = 3;

/**
 * Starts an email change for the signed-in person: { newEmail, currentPassword }. The current email keeps working
 * until the new one is confirmed from the link emailed to it (GET /api/account/email/confirm leads to /confirm-email,
 * where the person presses the button); the current address gets a notice showing the new one masked. Asking again
 * replaces the earlier link. Limits, each answered 429 RATE_LIMITED with Retry-After: 5 requests an hour per account
 * and 20 per network (wrong passwords included), and 3 links an hour to any one new address. Answers
 * { pendingEmail, pendingEmailExpiresAt, status: "sent" }.
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
  const rate = await consumeRateLimit(`account-email-change:${userId}`, REQUESTS_PER_ACCOUNT_PER_HOUR, HOUR_MS);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds, "You’ve asked to change your email a few times already. Please wait a while, then try again.");
  // Before the password and "already in use" checks, so they can't be tried endlessly from one network.
  const network = await consumeRateLimit(`account-email-change-ip:${clientAddress(request)}`, REQUESTS_PER_NETWORK_PER_HOUR, HOUR_MS);
  if (!network.allowed) return rateLimited(network.retryAfterSeconds, "Too many email change requests from this network. Please wait a while, then try again.");
  const body = await readJsonObject(request);
  if (!body) return invalidRequest();
  const newEmail = normaliseEmail(body.newEmail);
  if (!isValidEmail(newEmail)) return Response.json({ error: "Enter a valid email address, like name@example.com.", code: "INVALID_EMAIL" }, { status: 400 });

  try {
    const user = await db.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true, email: true, firstName: true, passwordHash: true, emailVerifiedAt: true } });
    if (!user) return signInRequired();
    if (newEmail === user.email) return Response.json({ error: "That’s already your email address.", code: "SAME_EMAIL" }, { status: 400 });
    // The password comes before anything that says whether another account uses the address.
    if (!(await currentPasswordMatches(body.currentPassword, user.passwordHash))) return wrongPassword();
    const taken = await db.user.findFirst({ where: { email: newEmail }, select: { id: true } });
    if (taken) return Response.json({ error: "Another PackAM account already uses that email.", code: "EMAIL_TAKEN" }, { status: 409 });
    // However many accounts ask for it, an address nobody has confirmed yet gets few links. The key holds a hash of
    // the inbox, never the address.
    const inbox = createHash("sha256").update(canonicalEmailForLimits(newEmail)).digest("hex");
    const perInbox = await consumeRateLimit(`account-email-change-to:${inbox}`, LINKS_PER_INBOX_PER_HOUR, HOUR_MS);
    if (!perInbox.allowed) {
      return rateLimited(perInbox.retryAfterSeconds, "We’ve already sent several confirmation links to that address in the last hour. Check its inbox and spam folder, or wait a while and try again.");
    }

    const now = new Date();
    const token = await db.$transaction(async (tx) => {
      // Locks the account's row and checks nothing changed since the password was checked: a password change, reset
      // or deletion that committed meanwhile matches nothing here, so no link outlives it; one that starts now waits
      // for this transaction, then retires the link as usual.
      const unchanged = await tx.user.updateMany({
        where: { id: user.id, status: "ACTIVE", email: user.email, passwordHash: user.passwordHash },
        data: { updatedAt: now },
      });
      if (unchanged.count !== 1) return null;
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
      // "Hi there,": the address isn't confirmed yet, so its owner may be a stranger, and gets no text the account chose.
      await sendEmail({ to: newEmail, purpose: "email-change", ...confirmEmailChange(null, link, newEmail) });
    });
    await afterResponse(async () => {
      // Names the new address only to a confirmed inbox: an unconfirmed one may belong to someone the account isn't.
      const confirmed = Boolean(user.emailVerifiedAt);
      const notice = emailChangeRequestedNotice(confirmedName(user), confirmed ? maskEmail(newEmail) : null);
      await sendEmail({ to: user.email, purpose: "email-change-requested", toConfirmedAddress: confirmed, ...notice });
    });
    return Response.json({ pendingEmail: newEmail, pendingEmailExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS.EMAIL_CHANGE), status: "sent" });
  } catch (error) {
    if (isSchemaBehindCode(error)) return accountSchemaBehindResponse(error, "POST /api/account/email");
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
    if (isSchemaBehindCode(error)) return accountSchemaBehindResponse(error, "DELETE /api/account/email");
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

function rateLimited(retryAfterSeconds: number, error: string) {
  return Response.json({ error, code: "RATE_LIMITED", retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
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
