import { auth } from "../../../../auth";
import { createPromoCode } from "../../../../lib/promo/promo-admin";
import { parseNewPromoCode } from "../../../../lib/promo/promo-admin-input";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

export const runtime = "nodejs";

/**
 * Admin: create a promo code. Body { code, type: "PERCENT" | "FIXED", value, maxDiscount?, minSubtotal?, maxUses?,
 * maxUsesPerStudent?, startsOn?, endsOn? } (dates "YYYY-MM-DD", campus days). Audited (PROMO_CODE_CREATED).
 *
 * 201 { promoCode: { id, code } }. Refusals are { error, code } with nothing written: 400 INVALID_REQUEST (with
 * `fields`); 409 PROMO_CODE_TAKEN; 503 PROMO_CODES_NOT_READY before the promo migration.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
  if (session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-promo-codes:${session.user.id}`, 30, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request.", code: "INVALID_REQUEST" }, { status: 400 }); }
  const parsed = parseNewPromoCode(body);
  if (!parsed.ok) return Response.json({ error: parsed.error, code: "INVALID_REQUEST", ...(parsed.field ? { fields: { [parsed.field]: parsed.error } } : {}) }, { status: 400 });

  try {
    const result = await createPromoCode(session.user.id, parsed.data);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("ADMIN PROMO CREATE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The promo code couldn’t be saved. Nothing was changed — try again." }, { status: 500 });
  }
}
