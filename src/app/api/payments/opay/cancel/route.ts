import { auth } from "../../../../../auth";
import { cancellationResponse, cancelUnpaidCheckout } from "../../../../../lib/payments/checkout-cancellation";
import { checkoutCancellationDeps } from "../../../../../lib/payments/checkout-cancellation-store";
import { consolePaymentLogger, referenceTail } from "../../../../../lib/payments/opay-verification";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

/** Cancels the signed-in student's own unpaid marketplace checkout, after reconciling it with OPay. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only students can cancel a PackAM order." }, { status: 403 });
  const rate = await consumeRateLimit(`opay-cancel:${session.user.id}`, 10, 10 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Please wait a little before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Payment reference is invalid." }, { status: 400 }); }
  const reference = body && typeof body === "object" && "reference" in body ? (body as { reference?: unknown }).reference : undefined;
  if (typeof reference !== "string" || !reference || reference.length > 100) {
    return Response.json({ error: "Payment reference is invalid." }, { status: 400 });
  }

  try {
    const result = await cancelUnpaidCheckout(checkoutCancellationDeps(reference, session.user.id));
    consolePaymentLogger.info("checkout_cancel_requested", { refTail: referenceTail(reference), outcome: result.kind });
    const response = cancellationResponse(result);
    return Response.json(response.body, { status: response.status });
  } catch (error) {
    consolePaymentLogger.error("checkout_cancel_failed", { refTail: referenceTail(reference), errorName: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "We couldn’t cancel this order right now. Nothing has changed — please try again." }, { status: 500 });
  }
}
