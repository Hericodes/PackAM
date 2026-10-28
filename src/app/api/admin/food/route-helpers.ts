import { auth } from "../../../../auth";
import { canManageCatalogue } from "../../../../lib/catalogue-permissions";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { PRODUCT_WRITE_LIMITS, PRODUCT_WRITE_WINDOW_MS, productLimitMessage, productWriteLimitKey } from "../../../../lib/products/write-limits";

/** Admin-only, rate limited like every other catalogue change. Returns the admin's id or a response to send. */
export async function requireFoodAdmin(kind: "edit" | "visibility" = "edit"): Promise<{ adminId: string } | { response: Response }> {
  const session = await auth();
  if (!session?.user || !canManageCatalogue(session.user.role)) return { response: Response.json({ error: "Only PackAM admins can manage food shops and menus." }, { status: 403 }) };
  const rate = await consumeRateLimit(productWriteLimitKey(kind, session.user.id), PRODUCT_WRITE_LIMITS[kind].limit, PRODUCT_WRITE_WINDOW_MS);
  if (!rate.allowed) return { response: Response.json({ error: productLimitMessage(kind, rate.retryAfterSeconds), retryAfterSeconds: rate.retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }) };
  return { adminId: session.user.id };
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

/** A change that only switches open/closed, listing or availability uses the larger visibility budget. */
export function isToggleOnly(body: unknown, keys: string[]) {
  return Boolean(body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1 && keys.includes(Object.keys(body)[0]));
}
