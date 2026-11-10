import { adminEmailError, adminEmailRequest } from "../../../../../lib/email/admin-route-guard";
import { sendCampaignTest } from "../../../../../lib/email/campaign-admin";
import { parseBroadcastInput, type EmailKindCode } from "../../../../../lib/email/campaign-rules";

export const runtime = "nodejs";

const KINDS: EmailKindCode[] = ["MORNING", "REMINDER", "ANNOUNCEMENT", "ORDER_UPDATE"];

/**
 * Admin: send one email to your own inbox exactly as students get it. Body { kind } or, for an announcement draft,
 * { kind: "ANNOUNCEMENT", subject, body, buttonLabel?, buttonUrl? }. At most 10 an hour.
 */
export async function POST(request: Request) {
  const checked = await adminEmailRequest(request);
  if ("response" in checked) return checked.response;
  const body = (checked.body ?? {}) as { kind?: unknown };
  const kind = body.kind as EmailKindCode;
  if (!KINDS.includes(kind)) return Response.json({ error: "Choose which email to test.", code: "INVALID_REQUEST" }, { status: 400 });
  let draft;
  if (kind === "ANNOUNCEMENT") {
    const parsed = parseBroadcastInput(body);
    if (!parsed.ok) return Response.json({ error: parsed.error, code: "INVALID_REQUEST", ...(parsed.field ? { fields: { [parsed.field]: parsed.error } } : {}) }, { status: 400 });
    draft = parsed.data;
  }
  try {
    const result = await sendCampaignTest(checked.adminId, kind, draft);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return adminEmailError("TEST", error);
  }
}
