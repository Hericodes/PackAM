import { PaymentProvider } from "@prisma/client";
import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { completeVerifiedPayment, failPendingPayment, markPaymentNeedsReview } from "../../../../../lib/payments/payment-lifecycle";
import { mapProviderStatus, queryPaymentStatus, verifyPayment } from "../../../../../lib/payments/providers/opay";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "STUDENT") return Response.json({ error: "Sign in to check payment." }, { status: 401 });
  const rate = await consumeRateLimit(`opay-status:${session.user.id}`, 15, 60_000);
  if (!rate.allowed) return Response.json({ error: "Please wait before checking again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const reference = new URL(request.url).searchParams.get("reference");
  if (!reference || reference.length > 100) return Response.json({ error: "Payment reference is invalid." }, { status: 400 });

  try {
    const attempt = await db.payment.findFirst({
      where: { transactionReference: reference, userId: session.user.id, provider: PaymentProvider.OPAY },
      select: { transactionReference: true, providerReference: true, providerCheckoutReference: true, amount: true, currency: true, status: true, orderId: true },
    });
    if (!attempt) return Response.json({ error: "Payment attempt not found." }, { status: 404 });
    if (attempt.status === "SUCCESS") return Response.json({ status: "SUCCESS", orderId: attempt.orderId });
    if (attempt.status === "FAILED") return Response.json({ status: "FAILED" });

    const transaction = await queryPaymentStatus(reference);
    const verified = verifyPayment(transaction, {
      reference,
      amount: attempt.amount,
      currency: attempt.currency,
      providerCheckoutReference: attempt.providerCheckoutReference,
    });
    if (verified.status === "SUCCESS") {
      const result = await completeVerifiedPayment({
        transactionReference: reference,
        providerReference: verified.providerReference!,
        provider: PaymentProvider.OPAY,
        amount: attempt.amount,
        currency: attempt.currency,
        status: "SUCCESS",
      });
      return Response.json({ status: "SUCCESS", orderId: result.orderId });
    }
    if (verified.status === "FAILED") {
      await failPendingPayment(reference);
      return Response.json({ status: "FAILED" });
    }
    return Response.json({ status: mapProviderStatus(transaction.status) });
  } catch (error) {
    console.error("OPAY STATUS CHECK ERROR:", error instanceof Error ? error.name : "Unknown error");
    const detail = error instanceof Error ? error.message : "";
    if (/mismatch|does not match|amount|currency|reference|merchant/i.test(detail)) {
      try { await markPaymentNeedsReview(reference, "provider status mismatch"); } catch (reviewError) { console.error("OPAY PAYMENT REVIEW FLAG ERROR:", reviewError instanceof Error ? reviewError.name : "Unknown error"); }
    }
    return Response.json({ error: "We’re still confirming your payment. Please check again shortly." }, { status: 503 });
  }
}
