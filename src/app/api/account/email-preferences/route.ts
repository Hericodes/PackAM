import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { updateEmailPreferences, type EmailPreferences } from "../../../../lib/email/campaign-store";
import { EMAIL_SCOPES } from "../../../../lib/email/unsubscribe";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

export const runtime = "nodejs";

/**
 * Settings → Emails: a student turns kinds of automated email on or off. Body: any of { morning, reminders,
 * announcements, orderUpdates } as booleans; the rest keep their value. 200 { preferences }; 503 before the email
 * migration (nothing saved).
 */
export async function PATCH(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to change your emails.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only students get these emails." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "PackAM couldn’t read that request. Refresh the page and try again.", code: "INVALID_REQUEST" }, { status: 400 });
  const change: Partial<EmailPreferences> = {};
  for (const scope of EMAIL_SCOPES) {
    if (body[scope] === undefined) continue;
    if (typeof body[scope] !== "boolean") return Response.json({ error: "Each email setting must be on or off.", code: "INVALID_REQUEST" }, { status: 400 });
    change[scope] = body[scope] as boolean;
  }
  if (!Object.keys(change).length) return Response.json({ error: "Nothing to change.", code: "INVALID_REQUEST" }, { status: 400 });
  try {
    const preferences = await updateEmailPreferences(db, session.user.id, change);
    if (!preferences) return Response.json({ error: "Email settings aren’t available yet. Try again later.", code: "EMAILS_NOT_READY" }, { status: 503 });
    return Response.json({ preferences });
  } catch (error) {
    console.error("EMAIL PREFERENCES ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Your email settings couldn’t be saved. Try again." }, { status: 500 });
  }
}
