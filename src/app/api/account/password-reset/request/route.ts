import { createHash } from "node:crypto";

import { db } from "../../../../../lib/db";
import { afterResponse } from "../../../../../lib/after-response";
import { appUrl } from "../../../../../lib/app-url";
import { isSchemaBehindCode, accountSchemaBehindResponse } from "../../../../../lib/db-errors";
import { isEmailConfigured, sendEmail } from "../../../../../lib/email";
import { resetPassword } from "../../../../../lib/email/templates";
import { issueAccountToken } from "../../../../../lib/account/account-tokens";
import { isValidEmail, normaliseEmail } from "../../../../../lib/account/validation";
import { clientAddress, consumeRateLimit } from "../../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../../lib/request-guards";

const HOUR_MS = 60 * 60 * 1000;
/** Plenty for a shared campus network; stops one address spraying reset emails. */
const REQUESTS_PER_ADDRESS_PER_HOUR = 10;
/** Per email address, counted whether or not an account uses it. Over it, the answer doesn't change; nothing is sent. */
const EMAILS_PER_ADDRESS_PER_HOUR = 3;

/**
 * Forgot password: emails a 30-minute reset link to an ACTIVE account that already has a password. The answer is
 * the same 200 {ok:true} for every well-formed address (no account, a suspended or closed one, one without a
 * password, or one over its hourly limit), and the link is created and sent after the response, so neither the
 * answer nor its timing says whether an account exists. Accounts without a password (seeded staff) are never given
 * a first one this way.
 *
 * 503 EMAIL_NOT_CONFIGURED when no email can go out at all, 429 only for too many requests from one network,
 * 400 INVALID_EMAIL for something that isn't an email address.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  if (!canEmailLinks()) {
    return Response.json(
      { error: "Password reset by email isn’t available right now. Contact PackAM support and we’ll help you get back into your account.", code: "EMAIL_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  try {
    const rate = await consumeRateLimit(`forgot-password:${clientAddress(request)}`, REQUESTS_PER_ADDRESS_PER_HOUR, HOUR_MS);
    if (!rate.allowed) {
      return Response.json(
        { error: "Too many reset requests from this network. Please wait a while, then try again.", code: "RATE_LIMITED", retryAfterSeconds: rate.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const body = await readBody(request);
    const email = normaliseEmail(body.email);
    if (!isValidEmail(email)) {
      return Response.json({ error: "Enter the email address on your PackAM account, like you@example.com.", code: "INVALID_EMAIL" }, { status: 400 });
    }

    // The key carries a hash, never the address itself.
    const perEmail = await consumeRateLimit(`forgot-password-email:${createHash("sha256").update(email).digest("hex")}`, EMAILS_PER_ADDRESS_PER_HOUR, HOUR_MS);
    if (perEmail.allowed) {
      const user = await db.user.findUnique({
        where: { email },
        // emailVerifiedAt isn't used here: it comes from the same migration as AccountToken, so selecting it makes a
        // database that hasn't been migrated answer 503 now, instead of promising a link that can't be stored.
        select: { id: true, email: true, firstName: true, status: true, passwordHash: true, emailVerifiedAt: true },
      });
      if (user && user.status === "ACTIVE" && user.passwordHash) {
        const account = { id: user.id, email: user.email, firstName: user.firstName };
        await afterResponse(() => sendResetLink(account));
      }
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (isSchemaBehindCode(error)) return accountSchemaBehindResponse(error, "password reset request");
    console.error("PASSWORD RESET REQUEST ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

/** Runs after the response: a new link (older reset links stop working) and the email that carries it. */
async function sendResetLink(account: { id: string; email: string; firstName: string | null }) {
  try {
    const token = await db.$transaction((tx) => issueAccountToken(tx, { userId: account.id, purpose: "PASSWORD_RESET", email: account.email }));
    // A failed send is logged by sendEmail (purpose and error name only); the person can simply ask again.
    await sendEmail({ to: account.email, purpose: "password-reset", ...resetPassword(account.firstName, appUrl(`/reset-password?token=${token}`)) });
  } catch (error) {
    console.error("PASSWORD RESET REQUEST ERROR:", error instanceof Error ? error.name : "Unknown error");
  }
}

/**
 * Email can go out and links can be built (APP_URL is usable). This is about the deployment, never about an
 * account, so answering 503 when it's false reveals nothing.
 */
function canEmailLinks() {
  if (!isEmailConfigured()) return false;
  try {
    appUrl("/reset-password");
    return true;
  } catch (error) {
    console.error("PASSWORD RESET REQUEST ERROR:", error instanceof Error ? error.name : "Unknown error");
    return false;
  }
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
