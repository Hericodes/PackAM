import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { afterResponse } from "../../../../../lib/after-response";
import { appUrl } from "../../../../../lib/app-url";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../../../lib/db-errors";
import { isEmailConfigured, sendEmail } from "../../../../../lib/email";
import { verifyEmail } from "../../../../../lib/email/templates";
import { issueAccountToken } from "../../../../../lib/account/account-tokens";
import { isValidEmail } from "../../../../../lib/account/validation";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { rejectCrossSite } from "../../../../../lib/request-guards";

const HOUR_MS = 60 * 60 * 1000;
const LINKS_PER_HOUR = 3;
/** Measured from the newest confirmation link of any kind (sign-up's included), to the second. */
const COOLDOWN_MS = 60 * 1000;

/**
 * Sends the signed-in person a new 24-hour link to confirm their email; older links stop working. It reads no
 * body, so only the cross-site guard runs (send it with or without a JSON body). The email goes out after the
 * response.
 *
 * 200 {status:"sent"} or {status:"already-verified"}; 401 signed out; 429 RATE_LIMITED (Retry-After and
 * retryAfterSeconds) within 60 seconds of the last link or after 3 links in an hour; 503 EMAIL_NOT_CONFIGURED
 * when no email can be sent; 409 EMAIL_UNDELIVERABLE when the account's address can't receive mail.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Log in to confirm your email." }, { status: 401 });

  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true, status: true, emailVerifiedAt: true } });
    if (!user || user.status !== "ACTIVE") return Response.json({ error: "Log in to confirm your email." }, { status: 401 });
    if (user.emailVerifiedAt) return Response.json({ status: "already-verified" });
    if (!canEmailLinks()) {
      return Response.json(
        { error: "PackAM can’t send emails right now, so we couldn’t send a new link. Please try again later.", code: "EMAIL_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    // Accounts made before addresses were checked can hold one that no mail can reach.
    if (!isValidEmail(user.email)) {
      return Response.json(
        { error: "We can’t send email to the address on your account. Change it to one you use, then try again.", code: "EMAIL_UNDELIVERABLE" },
        { status: 409 },
      );
    }

    const now = new Date();
    const latest = await db.accountToken.findFirst({
      where: { userId, purpose: "EMAIL_VERIFICATION" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const waitMs = latest ? latest.createdAt.getTime() + COOLDOWN_MS - now.getTime() : 0;
    if (waitMs > 0) return tooSoon(Math.ceil(waitMs / 1000), "We’ve just sent you a link. Give it a minute to arrive before asking for another.");
    const rate = await consumeRateLimit(`verify-email-resend:${userId}`, LINKS_PER_HOUR, HOUR_MS);
    if (!rate.allowed) return tooSoon(rate.retryAfterSeconds, "You’ve asked for several links in the last hour. Check your inbox and spam folder, or try again later.");

    const token = await db.$transaction((tx) => issueAccountToken(tx, { userId, purpose: "EMAIL_VERIFICATION", email: user.email, now }));
    const link = appUrl(`/api/account/verify-email?token=${token}`);
    await afterResponse(async () => {
      // A failed send is logged by sendEmail (purpose and error name only); the person can ask again after the cooldown.
      await sendEmail({ to: user.email, purpose: "email-verification", ...verifyEmail(user.firstName, link) });
    });
    return Response.json({ status: "sent" });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "email verification resend");
    console.error("VERIFICATION RESEND ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t send a new link. Please try again." }, { status: 500 });
  }
}

function tooSoon(retryAfterSeconds: number, error: string) {
  return Response.json(
    { error, code: "RATE_LIMITED", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/** Email can go out and links can be built (APP_URL is usable). */
function canEmailLinks() {
  if (!isEmailConfigured()) return false;
  try {
    appUrl("/api/account/verify-email");
    return true;
  } catch (error) {
    console.error("VERIFICATION RESEND ERROR:", error instanceof Error ? error.name : "Unknown error");
    return false;
  }
}
