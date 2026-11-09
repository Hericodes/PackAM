import { auth } from "../../../../../auth";
import { setPromoCodeActive } from "../../../../../lib/promo/promo-admin";
import { parsePromoActiveChange } from "../../../../../lib/promo/promo-admin-input";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../../lib/request-guards";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

/**
 * Admin: pause or resume a promo code. Body { active }. Audited (PROMO_CODE_PAUSED / PROMO_CODE_RESUMED).
 * 200 { promoCode, changed }; 400 INVALID_REQUEST; 404 PROMO_CODE_NOT_FOUND; 503 PROMO_CODES_NOT_READY.
 */
export async function PATCH(request: Request, context: Context) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
  if (session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-promo-codes:${session.user.id}`, 30, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request.", code: "INVALID_REQUEST" }, { status: 400 }); }
  const parsed = parsePromoActiveChange(body);
  if (!parsed.ok) return Response.json({ error: parsed.error, code: "INVALID_REQUEST" }, { status: 400 });

  try {
    const { id } = await context.params;
    const result = await setPromoCodeActive(session.user.id, id, parsed.data.active);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("ADMIN PROMO PAUSE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The promo code couldn’t be changed. Nothing was changed — try again." }, { status: 500 });
  }
}
