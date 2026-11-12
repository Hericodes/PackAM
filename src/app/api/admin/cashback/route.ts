import { adminApiAccess } from "../../../../lib/admin/admin-access";
import { updateCashbackSettings } from "../../../../lib/cashback/cashback-admin";

export const runtime = "nodejs";

/** Admin → Cashback rules. Body { enabled, ratePercent, welcomeBonus }. */
export async function PATCH(request: Request) {
  const allowed = await adminApiAccess();
  if (!allowed.ok) return allowed.response;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Send the cashback settings." }, { status: 400 }); }
  try {
    const result = await updateCashbackSettings(allowed.access.userId, body);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("CASHBACK SETTINGS ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t save the cashback settings. Try again." }, { status: 500 });
  }
}
