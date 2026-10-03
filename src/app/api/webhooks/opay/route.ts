import { PaymentProvider } from "@prisma/client";
import { db } from "../../../../lib/db";
import { completeVerifiedPayment, failPendingPayment, markPaymentNeedsReview } from "../../../../lib/payments/payment-lifecycle";
import { mapProviderStatus, queryPaymentStatus, verifyCallbackSignature, verifyPayment } from "../../../../lib/payments/providers/opay";
import { matchesOpayCallbackAmount } from "../../../../lib/payments/providers/opay-money";

type Callback = {
  payload: {
    amount: string;
    currency: string;
    reference: string;
    country: string;
    refunded: boolean;
    status: string;
    timestamp: string;
    token?: string;
    transactionId: string;
  };
  sha512: string;
  type: string;
};

function isCallback(value: unknown): value is Callback {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<Callback>;
  const payload = body.payload;
  return !!payload && typeof payload === "object" &&
    typeof payload.amount === "string" && typeof payload.currency === "string" &&
    typeof payload.reference === "string" && typeof payload.country === "string" &&
    typeof payload.refunded === "boolean" && typeof payload.status === "string" &&
    typeof payload.timestamp === "string" && typeof payload.transactionId === "string" &&
    typeof body.sha512 === "string" && typeof body.type === "string";
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid callback." }, { status: 400 }); }
  if (!isCallback(body) || body.type !== "transaction-status" || body.payload.country !== "NG" || body.payload.refunded) {
    return Response.json({ error: "Invalid callback." }, { status: 400 });
  }
  let verifiedReference: string | null = null;
  try {
    if (!verifyCallbackSignature({ payload: body.payload, sha512: body.sha512 })) {
      console.warn("Rejected OPay callback with invalid signature.");
      return Response.json({ error: "Invalid callback signature." }, { status: 400 });
    }

    const reference = body.payload.reference;
    verifiedReference = reference;
    const attempt = await db.payment.findFirst({
      where: { transactionReference: reference, provider: PaymentProvider.OPAY },
      select: { amount: true, currency: true, status: true, providerCheckoutReference: true },
    });
    if (!attempt) {
      console.error("Verified OPay callback did not match a PackAM payment attempt.");
      return new Response(null, { status: 200 });
    }
    if (body.payload.currency.toUpperCase() !== attempt.currency || !matchesOpayCallbackAmount(body.payload.amount, attempt.amount)) {
      console.error("Verified OPay callback amount or currency did not match its payment attempt.");
      await markPaymentNeedsReview(reference, "signed callback amount/currency mismatch");
      return new Response(null, { status: 200 });
    }

    const callbackStatus = mapProviderStatus(body.payload.status);
    if (callbackStatus === "PENDING") return new Response(null, { status: 200 });

    // A signed callback is a trigger to query OPay. Only the status API can authorize finalization.
    const transaction = await queryPaymentStatus(reference);
    const verified = verifyPayment(transaction, {
      reference,
      amount: attempt.amount,
      currency: attempt.currency,
      providerCheckoutReference: attempt.providerCheckoutReference,
    });
    const providerTransactionId = transaction.transactionId ?? transaction.orderNo;
    if (providerTransactionId !== body.payload.transactionId) {
      throw new Error("OPay callback transaction identifier does not match queried payment.");
    }

    if (verified.status === "SUCCESS") {
      await completeVerifiedPayment({
        transactionReference: reference,
        providerReference: verified.providerReference!,
        provider: PaymentProvider.OPAY,
        amount: attempt.amount,
        currency: attempt.currency,
        status: "SUCCESS",
      });
    } else if (verified.status === "FAILED") {
      await failPendingPayment(reference);
    }
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("OPAY CALLBACK VERIFICATION ERROR:", error instanceof Error ? error.name : "Unknown error");
    const detail = error instanceof Error ? error.message : "";
    if (verifiedReference && /mismatch|does not match|amount|currency|reference|merchant/i.test(detail)) {
      try { await markPaymentNeedsReview(verifiedReference, "provider verification mismatch"); } catch (reviewError) { console.error("OPAY PAYMENT REVIEW FLAG ERROR:", reviewError instanceof Error ? reviewError.name : "Unknown error"); }
    }
    return Response.json({ error: "Callback could not be verified yet." }, { status: 503 });
  }
}
