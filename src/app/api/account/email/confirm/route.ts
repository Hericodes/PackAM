import { Prisma } from "@prisma/client";

import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit";
import { afterResponse } from "../../../../../lib/after-response";
import { isSchemaBehindCode, accountSchemaBehindResponse } from "../../../../../lib/db-errors";
import { sendEmail } from "../../../../../lib/email";
import { emailChangedNotice } from "../../../../../lib/email/templates";
import { consumeAccountToken, revokeAccountTokens } from "../../../../../lib/account/account-tokens";
import { hashToken, isWellFormedToken } from "../../../../../lib/account/tokens";

// The token is only ever in this request's address: never cached, and never passed on as a Referer.
const LINK_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

type Outcome =
  | { kind: "changed"; userId: string; previousEmail: string | null; firstName: string | null }
  | { kind: "invalid" | "expired" | "used" | "taken" };

/**
 * The link in the "confirm your new email" message (works signed out). Re-checks that no other account took the
 * address meanwhile, switches the account's email, marks it confirmed, retires every other link sent to the old
 * address and tells the old address. Then 303 to /settings?email=changed, or /login?emailChanged=1 when this
 * browser isn't signed in as that account; otherwise to /settings?email=invalid|expired|used|taken. A link that
 * was already used for this same change (a mail scanner may open it first) still answers "changed".
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  try {
    const outcome = await applyEmailChange(token);
    if (outcome.kind !== "changed") return redirectTo(`/settings?email=${outcome.kind}`);
    const { previousEmail, firstName } = outcome;
    if (previousEmail) {
      await afterResponse(async () => {
        await sendEmail({ to: previousEmail, purpose: "email-changed", ...emailChangedNotice(firstName) });
      });
    }
    const session = await auth();
    return redirectTo(session?.user?.id === outcome.userId ? "/settings?email=changed" : "/login?emailChanged=1");
  } catch (error) {
    if (isSchemaBehindCode(error)) return accountSchemaBehindResponse(error, "GET /api/account/email/confirm");
    console.error("EMAIL CHANGE CONFIRM ERROR:", error instanceof Error ? error.name : "Unknown error");
    // Nothing was changed and the link wasn't used up, so opening it again can still work.
    return Response.json({ error: "We couldn’t confirm your new email just now. Please open the link again in a few minutes." }, { status: 500, headers: LINK_HEADERS });
  }
}

/** Link checkers often send HEAD first. Without this, Next would answer HEAD by running GET, using the link up. */
export function HEAD() {
  return new Response(null, { status: 200, headers: LINK_HEADERS });
}

function redirectTo(path: string) {
  return new Response(null, { status: 303, headers: { Location: path, ...LINK_HEADERS } });
}

async function applyEmailChange(token: string | null): Promise<Outcome> {
  const now = new Date();
  try {
    return await db.$transaction(async (tx): Promise<Outcome> => {
      const consumed = await consumeAccountToken(tx, { token, purpose: "EMAIL_CHANGE", now });
      if (!consumed.ok) return consumed.reason === "used" ? alreadyConfirmed(tx, token) : { kind: consumed.reason };
      // A suspended or deleted account is never changed (its link just stops working).
      const user = await tx.user.findFirst({ where: { id: consumed.userId, status: "ACTIVE" }, select: { id: true, email: true, firstName: true } });
      if (!user) return { kind: "invalid" };
      const taken = await tx.user.findFirst({ where: { email: consumed.email, NOT: { id: user.id } }, select: { id: true } });
      if (taken) return { kind: "taken" };
      const switched = await tx.user.updateMany({ where: { id: user.id, status: "ACTIVE" }, data: { email: consumed.email, emailVerifiedAt: now } });
      if (switched.count !== 1) return { kind: "invalid" };
      // Every other link sent to the old address (confirmation, password reset, older changes) stops working.
      await revokeAccountTokens(tx, { userId: user.id, now });
      await writeAuditLog(tx, {
        actorId: user.id,
        action: "ACCOUNT_EMAIL_CHANGED",
        resource: "User",
        resourceId: user.id,
        newState: { emailVerified: true },
        details: "New email confirmed from the emailed link.",
      });
      return { kind: "changed", userId: user.id, previousEmail: user.email === consumed.email ? null : user.email, firstName: user.firstName };
    });
  } catch (error) {
    // Another account took the address between the check and the update. Nothing changed, and the link is unused.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { kind: "taken" };
    throw error;
  }
}

/** A used link whose new address is already the account's email: this change went through earlier. */
async function alreadyConfirmed(tx: Prisma.TransactionClient, token: string | null): Promise<Outcome> {
  if (!isWellFormedToken(token)) return { kind: "used" };
  const row = await tx.accountToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { purpose: true, email: true, user: { select: { id: true, email: true, status: true } } },
  });
  if (row?.purpose === "EMAIL_CHANGE" && row.user.status === "ACTIVE" && row.user.email === row.email) {
    return { kind: "changed", userId: row.user.id, previousEmail: null, firstName: null };
  }
  return { kind: "used" };
}
