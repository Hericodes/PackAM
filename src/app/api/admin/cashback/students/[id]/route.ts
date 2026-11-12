import { adminApiAccess } from "../../../../../../lib/admin/admin-access";
import { adjustCashback, studentCashbackForAdmin } from "../../../../../../lib/cashback/cashback-admin";
import { consumeRateLimit } from "../../../../../../lib/rate-limit";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/** A student's cashback balance and recent history. */
export async function GET(_request: Request, context: Context) {
  const allowed = await adminApiAccess();
  if (!allowed.ok) return allowed.response;
  const { id } = await context.params;
  try {
    const result = await studentCashbackForAdmin(id);
    return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("CASHBACK LOOKUP ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t load their cashback. Try again." }, { status: 500 });
  }
}

/** Add (amount > 0) or take away (amount < 0) a student's cashback. Body { amount, note }. */
export async function POST(request: Request, context: Context) {
  const allowed = await adminApiAccess();
  if (!allowed.ok) return allowed.response;
  const rate = await consumeRateLimit(`cashback-adjust:${allowed.access.userId}`, 30, 10 * 60_000);
  if (!rate.allowed) return Response.json({ error: "That’s a lot of changes. Wait a few minutes and try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Enter an amount and a reason." }, { status: 400 }); }
  try {
    const result = await adjustCashback(allowed.access.userId, id, body);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("CASHBACK ADJUST ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t change their cashback. Try again." }, { status: 500 });
  }
}
