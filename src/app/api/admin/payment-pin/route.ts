import { auth } from "../../../../auth";
import { isSchemaBehindCode } from "../../../../lib/db-errors";
import { resetPaymentPin, setPaymentPin } from "../../../../lib/payments/payment-pin-store";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

export const runtime = "nodejs";

/**
 * An admin's payment PIN. Body: { action: "set", currentPassword, newPin, currentPin? } sets or changes your own PIN
 * (changing needs the current one); { action: "reset", pin, targetUserId } removes another admin's PIN, approved with
 * your own. 10 tries an hour per admin, on top of the PIN's own lock.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-payment-pin:${session.user.id}`, 10, 60 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Too many tries. Please wait a while, then try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  try {
    const result = record.action === "set"
      ? await setPaymentPin(session.user.id, { currentPassword: record.currentPassword, currentPin: record.currentPin, newPin: record.newPin })
      : record.action === "reset"
        ? await resetPaymentPin(session.user.id, record.pin, record.targetUserId)
        : { status: 400, body: { error: "Choose set or reset." } };
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    if (isSchemaBehindCode(error)) {
      console.error("ADMIN PAYMENT PIN: AdminPaymentPin table missing; apply migration 20261103130000_admin_payment_pin.");
      return Response.json({ error: "Payment PINs aren’t set up on this database yet. Nothing was changed." }, { status: 503 });
    }
    console.error("ADMIN PAYMENT PIN ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "That didn’t complete. Nothing was changed — please try again." }, { status: 500 });
  }
}
