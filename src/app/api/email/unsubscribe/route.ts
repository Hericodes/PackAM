import { db } from "../../../../lib/db";
import { updateEmailPreferences, DEFAULT_EMAIL_PREFERENCES } from "../../../../lib/email/campaign-store";
import { EMAIL_SCOPES, verifyUnsubscribeToken, type EmailScope } from "../../../../lib/email/unsubscribe";
import { rejectCrossSite } from "../../../../lib/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unsubscribe without signing in. Two callers:
 * - Mail apps' one-tap "Unsubscribe" (RFC 8058): POST ?t=<token> with the form body "List-Unsubscribe=One-Click".
 *   Stops the kind of email the token was made for.
 * - The /email/unsubscribe page: POST JSON { token, all? }. `all: true` stops every kind (any valid token proves the
 *   address is the student's own).
 * The token is signed per student and kind (src/lib/email/unsubscribe.ts). 200 { stopped: [...] }; 400 for a bad or
 * old-key token; 503 before the email migration. Nothing else about the account is shown or changed.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const url = new URL(request.url);
  let token: unknown = url.searchParams.get("t");
  let all = false;
  if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    const body = await request.json().catch(() => null) as { token?: unknown; all?: unknown } | null;
    token = body?.token ?? token;
    all = body?.all === true;
  }
  const verified = verifyUnsubscribeToken(process.env.AUTH_SECRET, token);
  if (!verified) return Response.json({ error: "This unsubscribe link isn’t valid any more. You can change your emails in Settings." }, { status: 400 });
  const stopped: EmailScope[] = all ? [...EMAIL_SCOPES] : [verified.scope];
  const change = Object.fromEntries(stopped.map((scope) => [scope, false])) as Partial<typeof DEFAULT_EMAIL_PREFERENCES>;
  try {
    const user = await db.user.findUnique({ where: { id: verified.userId }, select: { id: true } });
    // An account that no longer exists gets no email anyway; answer the same way so a token reveals nothing.
    if (!user) return Response.json({ stopped });
    const saved = await updateEmailPreferences(db, verified.userId, change);
    if (!saved) return Response.json({ error: "We couldn’t update your emails right now. Try again shortly." }, { status: 503 });
    return Response.json({ stopped });
  } catch (error) {
    console.error("UNSUBSCRIBE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t update your emails right now. Try again shortly." }, { status: 500 });
  }
}
