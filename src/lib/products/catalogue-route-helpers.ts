import "server-only";

import { auth } from "../../auth";
import { canManageCatalogue } from "../catalogue-permissions";
import { consumeRateLimit } from "../rate-limit";
import { PRODUCT_WRITE_LIMITS, PRODUCT_WRITE_WINDOW_MS, productLimitMessage, productWriteLimitKey } from "./write-limits";

/** Admin-only and rate limited like every catalogue change. Returns the admin's id, or a response to send. */
export async function requireCatalogueAdmin(): Promise<{ adminId: string } | { response: Response }> {
  const session = await auth();
  if (!session?.user || !canManageCatalogue(session.user.role)) return { response: Response.json({ error: "Only PackAM admins can change the catalogue." }, { status: 403 }) };
  const rate = await consumeRateLimit(productWriteLimitKey("edit", session.user.id), PRODUCT_WRITE_LIMITS.edit.limit, PRODUCT_WRITE_WINDOW_MS);
  if (!rate.allowed) return { response: Response.json({ error: productLimitMessage("edit", rate.retryAfterSeconds) }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }) };
  return { adminId: session.user.id };
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

/** A unique-name clash (P2002), turned into a plain message by the caller. */
export function isUniqueClash(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}
