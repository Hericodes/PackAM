import { adminEmailError, adminEmailRequest } from "../../../../../../lib/email/admin-route-guard";
import { cancelBroadcast } from "../../../../../../lib/email/campaign-admin";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

/** Admin: stop an announcement that is still sending. Body { action: "cancel" }. Emails already sent stay sent. Audited. */
export async function PATCH(request: Request, context: Context) {
  const checked = await adminEmailRequest(request);
  if ("response" in checked) return checked.response;
  if ((checked.body as { action?: unknown } | null)?.action !== "cancel") return Response.json({ error: "Invalid request.", code: "INVALID_REQUEST" }, { status: 400 });
  try {
    const { id } = await context.params;
    const result = await cancelBroadcast(checked.adminId, id);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return adminEmailError("CANCEL", error);
  }
}
