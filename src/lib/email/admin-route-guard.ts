import "server-only";

import { auth } from "../../auth";
import { consumeRateLimit } from "../rate-limit";
import { rejectCrossSite, requireJson } from "../request-guards";

/**
 * The checks every Admin → Emails write route makes first: same-site JSON, a signed-in admin, and a rate limit. Returns
 * the admin's id and the parsed body, or the response to send instead.
 */
export async function adminEmailRequest(request: Request): Promise<{ adminId: string; body: unknown } | { response: Response }> {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return { response: blocked };
  const session = await auth();
  if (!session?.user) return { response: Response.json({ error: "Sign in to continue.", code: "SIGN_IN_REQUIRED" }, { status: 401 }) };
  if (session.user.role !== "ADMIN") return { response: Response.json({ error: "Admin access required." }, { status: 403 }) };
  const rate = await consumeRateLimit(`admin-emails:${session.user.id}`, 30, 60_000);
  if (!rate.allowed) return { response: Response.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }) };
  try {
    return { adminId: session.user.id, body: await request.json() };
  } catch {
    return { response: Response.json({ error: "Invalid request.", code: "INVALID_REQUEST" }, { status: 400 }) };
  }
}

export function adminEmailError(where: string, error: unknown) {
  console.error(`ADMIN EMAILS ${where} ERROR:`, error instanceof Error ? error.name : "Unknown error");
  return Response.json({ error: "That couldn’t be saved. Nothing was changed — try again." }, { status: 500 });
}
