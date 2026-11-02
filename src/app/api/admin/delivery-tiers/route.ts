import { auth } from "../../../../auth";
import { updateDeliveryTierSetting } from "../../../../lib/delivery-tier-admin";
import { parseTierSettingChange } from "../../../../lib/delivery-tier-admin-input";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

export const runtime = "nodejs";

/**
 * Admin: change one delivery tier's fee and/or on/off switch. Body { tier, version, fee?, enabled? }; every other key
 * (windows, wording) is ignored, so those can't be changed here. Every change is audited (DELIVERY_TIER_UPDATED).
 *
 * 200 { tier: { tier, fee, enabled, version, etaMinMinutes, etaMaxMinutes, updatedAt }, changed }. Refusals are
 * { error, code } with nothing written: 400 INVALID_REQUEST (with `fields`), FEE_REQUIRED or INVALID_TIER_SETTING;
 * 404 TIER_NOT_FOUND; 409 TIER_CHANGED (stale version) or LAST_ENABLED_TIER; 503 DELIVERY_TIERS_NOT_READY before the
 * tier migration. The same-site JSON guards answer 403 CROSS_SITE_REQUEST and 415 JSON_REQUIRED before anything else.
 */
export async function PATCH(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
  if (session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-delivery-tiers:${session.user.id}`, 30, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request.", code: "INVALID_REQUEST" }, { status: 400 }); }
  const parsed = parseTierSettingChange(body);
  if (!parsed.ok) return Response.json({ error: parsed.error, code: "INVALID_REQUEST", ...(parsed.field ? { fields: { [parsed.field]: parsed.error } } : {}) }, { status: 400 });

  try {
    const result = await updateDeliveryTierSetting(session.user.id, parsed.data);
    return Response.json(result.body, { status: result.status, ...(result.status === 503 ? { headers: { "Retry-After": "120" } } : {}) });
  } catch (error) {
    console.error("ADMIN DELIVERY TIERS ERROR:", error instanceof Error ? error.name : "Unknown error", error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "");
    return Response.json({ error: "The delivery prices couldn’t be saved. Nothing was changed — try again." }, { status: 500 });
  }
}
