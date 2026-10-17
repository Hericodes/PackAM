import { PaymentProvider } from "@prisma/client";
import { db } from "../../../../lib/db";
import { completeVerifiedPayment, failPendingPayment, markPaymentNeedsReview } from "../../../../lib/payments/payment-lifecycle";
import { queryPaymentStatus, verifyCallbackSignature } from "../../../../lib/payments/providers/opay";
import { consolePaymentLogger, handleOpayCallback } from "../../../../lib/payments/opay-verification";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid callback." }, { status: 400 }); }

  const result = await handleOpayCallback(body, {
    verifySignature: (callback) => verifyCallbackSignature({ payload: callback.payload, sha512: callback.sha512 }),
    findAttempt: async (reference) => {
      const attempt = await db.payment.findFirst({
        where: { transactionReference: reference, provider: PaymentProvider.OPAY },
        select: { amount: true, currency: true, providerCheckoutReference: true },
      });
      return attempt && { reference, amount: attempt.amount, currency: attempt.currency, providerCheckoutReference: attempt.providerCheckoutReference };
    },
    queryStatus: queryPaymentStatus,
    complete: (verified) => completeVerifiedPayment({ ...verified, provider: PaymentProvider.OPAY, status: "SUCCESS" }),
    fail: failPendingPayment,
    markReview: markPaymentNeedsReview,
    log: consolePaymentLogger,
  });
  return result.body ? Response.json(result.body, { status: result.status }) : new Response(null, { status: result.status });
}
