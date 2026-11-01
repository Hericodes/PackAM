import { accountSchemaBehindResponse, isSchemaBehindCode } from "../../../../lib/db-errors";
import { confirmEmailAddress, type VerifyStatus } from "../../../../lib/account/email-verification";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

// The token is only ever in the link's own address: never cached, and never passed on as a Referer.
const LINK_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/**
 * The link in a confirmation email: GET /api/account/verify-email?token=…. Opening it changes nothing: mail scanners
 * and link previews open links too, and one opening a link sent to an address the account's owner doesn't control
 * must never confirm it (a confirmed address unlocks the account's name in emails, and skips the shared per-inbox
 * limit). It only leads, with a 303, to /verify-email?token=…, a page that works signed in or out and asks for a press
 * of "Confirm my email", which POSTs here. Links sent before this worked this way land on the same page.
 */
export function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  // Whatever arrived goes on as it is (encoded): the page explains a link that is incomplete or isn't one of ours.
  return new Response(null, {
    status: 303,
    headers: { Location: token ? `/verify-email?${new URLSearchParams({ token })}` : "/verify-email", ...LINK_HEADERS },
  });
}

/**
 * Link checkers sometimes probe with HEAD first, and Next would answer HEAD by running GET. It changes nothing, like
 * GET, and doesn't even redirect.
 */
export function HEAD() {
  return new Response(null, { status: 204, headers: LINK_HEADERS });
}

/**
 * The "Confirm my email" button on /verify-email: { token }. Works signed in or out (the token is the proof). Answers
 * 200 { status: "verified" | "already" | "expired" | "used" | "invalid" }, or { status: "error" } with 500 (503 while
 * the database is behind the code); after "error" nothing was used up, so pressing again can still work.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const body = await readJsonObject(request);

  try {
    return answer(await confirmEmailAddress(body?.token ?? null));
  } catch (error) {
    if (isSchemaBehindCode(error)) {
      // The shared 503 (logged with the missing table or column, SERVICE_UPDATING, Retry-After), plus this route's status.
      const updating = accountSchemaBehindResponse(error, "POST /api/account/verify-email");
      return Response.json({ ...(await updating.json()), status: "error" }, { status: updating.status, headers: updating.headers });
    }
    console.error("EMAIL VERIFICATION ERROR:", error instanceof Error ? error.name : "Unknown error");
    return answer("error", 500);
  }
}

function answer(status: VerifyStatus | "error", httpStatus = 200) {
  return Response.json({ status }, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
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
