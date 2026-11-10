import { adminEmailError, adminEmailRequest } from "../../../../../lib/email/admin-route-guard";
import { createBroadcast } from "../../../../../lib/email/campaign-admin";
import { parseBroadcastInput } from "../../../../../lib/email/campaign-rules";

export const runtime = "nodejs";

/**
 * Admin: send an announcement to every student who has news and offers switched on. Body { subject, body, buttonLabel?,
 * buttonUrl? }. Sending starts within 5 minutes, in batches. 201 { broadcast }; 400 INVALID_REQUEST; 409 NO_RECIPIENTS;
 * 503 EMAILS_NOT_READY before the migration. Audited (EMAIL_BROADCAST_CREATED).
 */
export async function POST(request: Request) {
  const checked = await adminEmailRequest(request);
  if ("response" in checked) return checked.response;
  const parsed = parseBroadcastInput(checked.body);
  if (!parsed.ok) return Response.json({ error: parsed.error, code: "INVALID_REQUEST", ...(parsed.field ? { fields: { [parsed.field]: parsed.error } } : {}) }, { status: 400 });
  try {
    const result = await createBroadcast(checked.adminId, parsed.data);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return adminEmailError("BROADCAST", error);
  }
}
