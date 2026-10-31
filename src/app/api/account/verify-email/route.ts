import { db } from "../../../../lib/db";
import { isSchemaBehindCode, missingSchemaElement } from "../../../../lib/db-errors";
import { consumeAccountToken } from "../../../../lib/account/account-tokens";
import { hashToken, isWellFormedToken } from "../../../../lib/account/tokens";

/** What /verify-email shows. "error" means nothing was used up, so opening the link again can still work. */
type VerifyStatus = "verified" | "already" | "expired" | "used" | "invalid" | "error";

/**
 * The link in a confirmation email: GET /api/account/verify-email?token=…. It uses the link up and confirms the
 * address, but only while it is still the account's email (a link sent before an email change proves nothing about
 * the new address), then sends the browser to /verify-email?status=… with 303. Works signed out: the link is the
 * proof, so it never goes through /login, and the token never reaches the page it lands on.
 *
 * Mail scanners often open links before the person does. A spent or expired link whose address is already
 * confirmed therefore shows "already" rather than an error.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  let status: VerifyStatus;
  try {
    status = await confirmAddress(token);
  } catch (error) {
    if (isSchemaBehindCode(error)) {
      console.error(`SCHEMA BEHIND CODE in email verification: the database is missing ${missingSchemaElement(error)}. Apply the pending Prisma migrations (npx prisma migrate deploy) to this database.`);
    } else {
      console.error("EMAIL VERIFICATION ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
    status = "error";
  }
  return new Response(null, {
    status: 303,
    headers: { Location: `/verify-email?status=${status}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

/**
 * Link checkers sometimes probe with HEAD first, and Next would answer HEAD by running GET. Answering here
 * instead means only a real visit uses the link up.
 */
export function HEAD() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

async function confirmAddress(token: string | null): Promise<VerifyStatus> {
  const now = new Date();
  const status = await db.$transaction(async (tx): Promise<VerifyStatus> => {
    const claimed = await consumeAccountToken(tx, { token, purpose: "EMAIL_VERIFICATION", now });
    if (!claimed.ok) return claimed.reason;
    // Conditional, so an email change landing at the same moment can never be confirmed by the old link.
    const confirmed = await tx.user.updateMany({
      where: { id: claimed.userId, email: claimed.email, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    });
    if (confirmed.count === 1) return "verified";
    const account = await tx.user.findUnique({ where: { id: claimed.userId }, select: { email: true, emailVerifiedAt: true } });
    return account?.email === claimed.email && account.emailVerifiedAt ? "already" : "invalid";
  });
  if ((status === "used" || status === "expired") && (await alreadyConfirmed(token))) return "already";
  return status;
}

/** Whether a spent or expired link's address is, by now, the account's confirmed email. */
async function alreadyConfirmed(token: string | null) {
  if (!isWellFormedToken(token)) return false;
  const link = await db.accountToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { email: true, user: { select: { email: true, emailVerifiedAt: true } } },
  });
  return Boolean(link?.user.emailVerifiedAt && link.user.email === link.email);
}
