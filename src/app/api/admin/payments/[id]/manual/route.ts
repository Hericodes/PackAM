import { auth } from "../../../../../../auth";
import { consumeRateLimit } from "../../../../../../lib/rate-limit";
import { confirmManualPayment, rejectManualPayment } from "../../../../../../lib/payments/manual-transfer-store";
import { verifyPaymentPin } from "../../../../../../lib/payments/payment-pin-store";
import { isSchemaBehindCode } from "../../../../../../lib/db-errors";
import { rejectCrossSite, requireJson } from "../../../../../../lib/request-guards";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

/**
 * Confirm or reject one bank-transfer payment. Body: { action: "confirm", receivedAmount, pin } or { action: "reject",
 * note?, pin }. Both need the admin's own payment PIN (checked first; nothing happens without it). Confirming needs
 * the amount the bank shows and refuses anything below the order's amount; both are audited.
 */
export async function POST(request: Request, context: Context) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-manual-payment:${session.user.id}`, 30, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many payment actions. Wait a moment and try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const { id } = await context.params;
  if (!id || id.length > 100) return Response.json({ error: "Manual payment not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Choose confirm or reject." }, { status: 400 }); }
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as { action?: unknown; receivedAmount?: unknown; note?: unknown; pin?: unknown } : {};
  if (record.action !== "confirm" && record.action !== "reject") return Response.json({ error: "Choose confirm or reject." }, { status: 400 });

  try {
    const pin = await verifyPaymentPin(session.user.id, record.pin, `${record.action === "confirm" ? "confirming" : "rejecting"} payment ${id}`);
    if (!pin.ok) return Response.json({ error: pin.error, code: pin.code }, { status: pin.status });
    const result = record.action === "confirm"
      ? await confirmManualPayment(session.user.id, id, record.receivedAmount)
      : await rejectManualPayment(session.user.id, id, record.note);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    // Fails closed: without the PIN table nothing can be confirmed or rejected.
    if (isSchemaBehindCode(error)) {
      console.error("ADMIN MANUAL PAYMENT: AdminPaymentPin table missing; apply migration 20261103130000_admin_payment_pin.");
      return Response.json({ error: "Payment PINs aren’t set up on this database yet, so transfers can’t be confirmed or rejected. Nothing was changed." }, { status: 503 });
    }
    console.error("ADMIN MANUAL PAYMENT ERROR:", record.action, error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "That didn’t complete. Refresh the page and check the payment before trying again." }, { status: 500 });
  }
}
