import { Prisma } from "@prisma/client";

import { db } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit";
import { afterResponse } from "../../../../../lib/after-response";
import { isSchemaBehindCode, missingSchemaElement } from "../../../../../lib/db-errors";
import { sendEmail } from "../../../../../lib/email";
import { emailChangedNotice } from "../../../../../lib/email/templates";
import { consumeAccountToken, revokeAccountTokens } from "../../../../../lib/account/account-tokens";
import { hashToken, isWellFormedToken } from "../../../../../lib/account/tokens";
import { rejectCrossSite, requireJson } from "../../../../../lib/request-guards";

// The token is only ever in the link's own address: never cached, and never passed on as a Referer.
const LINK_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

type Outcome =
  | { kind: "changed"; previousEmail: string | null; firstName: string | null }
  | { kind: "invalid" | "expired" | "used" | "taken" };

/** What POST answers, as { status }. "error": nothing changed and the link wasn't used, so pressing again can work. */
type ConfirmStatus = Outcome["kind"] | "error";

/**
 * The link in the "confirm your new email" message. Opening it changes nothing: mail scanners and link previews open
 * links too, and one opening a link sent to a mistyped address must never hand that address (and with it, password
 * resets) the account. It only leads, with a 303, to /confirm-email?token=…, a page that works signed in or out,
 * shows the new address masked and asks for a press of "Confirm new email", which POSTs here. The token stays in the
 * query string, as it arrived.
 */
export function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  // Whatever arrived goes on as it is (encoded): the page explains a link that is incomplete or isn't one of ours.
  return redirectTo(token ? `/confirm-email?${new URLSearchParams({ token })}` : "/confirm-email");
}

/** Link checkers often send HEAD first. It changes nothing, like GET, and doesn't even redirect. */
export function HEAD() {
  return new Response(null, { status: 200, headers: LINK_HEADERS });
}

/**
 * The "Confirm new email" button on /confirm-email: { token }. Works signed in or out (the token is the proof).
 * Re-checks that no other account took the address meanwhile, switches the account's email, marks it confirmed,
 * retires every other link sent to the old address and tells the old address. Answers 200 { status: "changed" |
 * "expired" | "used" | "invalid" | "taken" }, or { status: "error" } with 500 (503 while the database is behind the
 * code). A link already used for this same change (pressed twice, or in two tabs) still answers "changed".
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const body = await readJsonObject(request);

  try {
    const outcome = await applyEmailChange(body?.token ?? null);
    if (outcome.kind === "changed" && outcome.previousEmail) {
      const { previousEmail, firstName } = outcome;
      await afterResponse(async () => {
        await sendEmail({ to: previousEmail, purpose: "email-changed", ...emailChangedNotice(firstName) });
      });
    }
    return answer(outcome.kind);
  } catch (error) {
    // Nothing was changed and the link wasn't used up, so pressing the button again can still work.
    if (isSchemaBehindCode(error)) {
      console.error(`SCHEMA BEHIND CODE in POST /api/account/email/confirm: the database is missing ${missingSchemaElement(error)}. Apply the pending Prisma migrations (npx prisma migrate deploy) to this database.`);
      return answer("error", 503);
    }
    console.error("EMAIL CHANGE CONFIRM ERROR:", error instanceof Error ? error.name : "Unknown error");
    return answer("error", 500);
  }
}

function redirectTo(path: string) {
  return new Response(null, { status: 303, headers: { Location: path, ...LINK_HEADERS } });
}

function answer(status: ConfirmStatus, httpStatus = 200) {
  return Response.json({ status }, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}

async function applyEmailChange(token: unknown): Promise<Outcome> {
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
      return { kind: "changed", previousEmail: user.email === consumed.email ? null : user.email, firstName: user.firstName };
    });
  } catch (error) {
    // Another account took the address between the check and the update. Nothing changed, and the link is unused.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { kind: "taken" };
    throw error;
  }
}

/** A used link whose new address is already the account's email: this change went through earlier. */
async function alreadyConfirmed(tx: Prisma.TransactionClient, token: unknown): Promise<Outcome> {
  if (!isWellFormedToken(token)) return { kind: "used" };
  const row = await tx.accountToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { purpose: true, email: true, user: { select: { email: true, status: true } } },
  });
  if (row?.purpose === "EMAIL_CHANGE" && row.user.status === "ACTIVE" && row.user.email === row.email) {
    return { kind: "changed", previousEmail: null, firstName: null };
  }
  return { kind: "used" };
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
