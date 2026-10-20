import { auth } from "../../../../../auth";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { cancelLinkedUnpaid, closeReviewCase, escalateReviewCase, reopenReviewCase, retryPaymentVerification } from "../../../../../lib/payments/payment-review";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const ACTIONS = ["verify", "cancel", "close", "reopen", "escalate"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Admin actions on an unresolved payment. None of them marks a payment paid or failed by hand: only a
 * verified OPay status record changes the money state, and every action is written to the audit log.
 */
export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-payment-review:${session.user.id}`, 20, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many payment actions. Wait a moment and try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const { id } = await context.params;
  if (!id || id.length > 100) return Response.json({ error: "Payment not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Choose a payment action." }, { status: 400 }); }
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as { action?: unknown; note?: unknown } : {};
  const action = ACTIONS.includes(record.action as Action) ? record.action as Action : null;
  if (!action) return Response.json({ error: "Choose verify, cancel, close, reopen or escalate." }, { status: 400 });

  try {
    const adminId = session.user.id;
    const result = action === "verify" ? await retryPaymentVerification(adminId, id)
      : action === "cancel" ? await cancelLinkedUnpaid(adminId, id)
        : action === "close" ? await closeReviewCase(adminId, id, record.note)
          : action === "reopen" ? await reopenReviewCase(adminId, id, record.note)
            : await escalateReviewCase(adminId, id, record.note);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("ADMIN PAYMENT REVIEW ERROR:", action, error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "That action didn’t complete. The payment record is unchanged — refresh and try again." }, { status: 500 });
  }
}
