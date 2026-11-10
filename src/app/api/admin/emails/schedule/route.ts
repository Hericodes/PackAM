import { adminEmailError, adminEmailRequest } from "../../../../../lib/email/admin-route-guard";
import { setEmailSchedule, type SwitchableKind } from "../../../../../lib/email/campaign-admin";

export const runtime = "nodejs";

const KINDS: SwitchableKind[] = ["MORNING", "REMINDER", "ORDER_UPDATE"];

/** Admin: turn the good-morning email, the order reminder or order update emails on or off. Body { kind, enabled }. Audited. */
export async function PATCH(request: Request) {
  const checked = await adminEmailRequest(request);
  if ("response" in checked) return checked.response;
  const { kind, enabled } = (checked.body ?? {}) as { kind?: unknown; enabled?: unknown };
  if (!KINDS.includes(kind as SwitchableKind) || typeof enabled !== "boolean") return Response.json({ error: "Choose an email and on or off.", code: "INVALID_REQUEST" }, { status: 400 });
  try {
    const result = await setEmailSchedule(checked.adminId, kind as SwitchableKind, enabled);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return adminEmailError("SCHEDULE", error);
  }
}
