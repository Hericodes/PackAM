import bcrypt from "bcryptjs";

import { db } from "../../../../../lib/db";
import { afterResponse } from "../../../../../lib/after-response";
import { writeAuditLog } from "../../../../../lib/audit";
import { isSchemaBehindCode, accountSchemaBehindResponse } from "../../../../../lib/db-errors";
import { sendEmail } from "../../../../../lib/email";
import { passwordChangedNotice } from "../../../../../lib/email/templates";
import { consumeAccountToken, peekAccountToken, revokeAccountTokens, type AccountTokenFailure } from "../../../../../lib/account/account-tokens";
import { passwordProblem } from "../../../../../lib/account/password-policy";
import { clientAddress, consumeRateLimit } from "../../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../../lib/request-guards";

const HOUR_MS = 60 * 60 * 1000;
const ATTEMPTS_PER_ADDRESS_PER_HOUR = 20;
/** The same cost as registration, and as the dummy hash login compares against. */
const BCRYPT_COST = 12;

const LINK_PROBLEMS = {
  invalid: { code: "INVALID_TOKEN", error: "This reset link isn’t valid. Make sure you opened the whole link from the email, or request a new one." },
  expired: { code: "EXPIRED_TOKEN", error: "This reset link has expired. Links work for 30 minutes, so request a new one." },
  used: { code: "USED_TOKEN", error: "This reset link has already been used. Each link works once, and only the newest one works. Request a new one if you still need it." },
} satisfies Record<AccountTokenFailure, { code: string; error: string }>;

/** Thrown inside the transaction so the link isn't used up when the account can no longer take a new password. */
class ResetRefusedError extends Error {
  constructor() {
    super("This account can’t be reset with this link.");
    this.name = "ResetRefusedError";
  }
}

/**
 * Sets a new password from an emailed reset link: {token, password}. In one transaction the link is used up, the
 * password replaced, every session signed out (sessionVersion + 1), any other reset or email-change link revoked,
 * and the email confirmed if it wasn't (opening the link proved the inbox). Only an ACTIVE account that already
 * has a password, still at the address the link was sent to, can be reset: a link never reactivates a suspended
 * or closed account. A notice goes to the account's email afterwards.
 *
 * 400 INVALID_TOKEN | EXPIRED_TOKEN | USED_TOKEN | WEAK_PASSWORD (a weak password leaves the link usable), 429 for
 * too many attempts from one network.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;

  try {
    const rate = await consumeRateLimit(`reset-password:${clientAddress(request)}`, ATTEMPTS_PER_ADDRESS_PER_HOUR, HOUR_MS);
    if (!rate.allowed) {
      return Response.json(
        { error: "Too many attempts from this network. Please wait a while, then try again.", code: "RATE_LIMITED", retryAfterSeconds: rate.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const body = await readBody(request);
    const password = typeof body.password === "string" ? body.password : "";

    // Checked without using the link up, so choosing a password that isn't allowed doesn't cost the link.
    const link = await peekAccountToken(db, { token: body.token, purpose: "PASSWORD_RESET" });
    if (!link.ok) return linkProblem(link.reason);
    const account = await db.user.findUnique({
      where: { id: link.userId },
      select: { email: true, firstName: true, lastName: true, status: true, passwordHash: true },
    });
    if (!account || account.status !== "ACTIVE" || !account.passwordHash || account.email !== link.email) return linkProblem("invalid");

    const problem = passwordProblem(password, { email: account.email, names: [account.firstName ?? "", account.lastName ?? ""] });
    if (problem) return Response.json({ error: problem, code: "WEAK_PASSWORD" }, { status: 400 });

    // Hashed before the transaction, so the slow part never holds a lock.
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const now = new Date();
    const outcome = await db.$transaction(async (tx) => {
      const claimed = await consumeAccountToken(tx, { token: body.token, purpose: "PASSWORD_RESET", now });
      if (!claimed.ok) return claimed;
      // Re-checked under the claim: still ACTIVE, still has a password, still at the address the link went to.
      const changed = await tx.user.updateMany({
        where: { id: claimed.userId, email: claimed.email, status: "ACTIVE", passwordHash: { not: null } },
        data: { passwordHash, passwordChangedAt: now, sessionVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ResetRefusedError();
      // Opening the link proved the person reads this inbox, and it is still the account's email.
      await tx.user.updateMany({ where: { id: claimed.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
      await revokeAccountTokens(tx, { userId: claimed.userId, purpose: "PASSWORD_RESET", now });
      // A reset can be someone taking their account back: an email change asked for before it shouldn't still go through.
      await revokeAccountTokens(tx, { userId: claimed.userId, purpose: "EMAIL_CHANGE", now });
      await writeAuditLog(tx, {
        actorId: claimed.userId,
        action: "PASSWORD_RESET",
        resource: "User",
        resourceId: claimed.userId,
        details: "New password set from an emailed reset link; every device was signed out.",
      });
      return { ok: true as const, email: claimed.email };
    });
    if (!outcome.ok) return linkProblem(outcome.reason);

    await afterResponse(async () => {
      await sendEmail({ to: outcome.email, purpose: "password-changed", ...passwordChangedNotice(account.firstName) });
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ResetRefusedError) return linkProblem("invalid");
    if (isSchemaBehindCode(error)) return accountSchemaBehindResponse(error, "password reset");
    console.error("PASSWORD RESET ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t save your new password. Please try again." }, { status: 500 });
  }
}

function linkProblem(reason: AccountTokenFailure) {
  return Response.json(LINK_PROBLEMS[reason], { status: 400 });
}

/** The JSON body as an object; anything else (malformed JSON, an array, a string) reads as empty. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
