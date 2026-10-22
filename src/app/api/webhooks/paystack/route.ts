import { db } from "../../../../lib/db";
import { paystackStatusDeps } from "../../../../lib/payments/gateways";
import { handlePaystackWebhook } from "../../../../lib/payments/paystack-verification";
import { paystackConfig } from "../../../../lib/payments/providers/paystack";
import type { PaystackTransaction } from "../../../../lib/payments/providers/paystack-core";
import type { VerificationDeps } from "../../../../lib/payments/opay-verification";

export const runtime = "nodejs";

/**
 * Paystack webhook (configure as https://<APP_URL>/api/webhooks/paystack in the Paystack dashboard).
 * The signature is checked against the exact raw bytes, so the body is read as text, never re-serialised.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 100_000) return Response.json({ error: "Webhook too large." }, { status: 413 });

  const result = await handlePaystackWebhook(rawBody, request.headers.get("x-paystack-signature"), {
    ...(paystackStatusDeps as VerificationDeps<PaystackTransaction>),
    secretKey: () => paystackConfig().secretKey,
    findAttempt: async (reference) => {
      const attempt = await db.payment.findFirst({
        where: { transactionReference: reference, provider: "PAYSTACK" },
        select: { amount: true, currency: true, providerCheckoutReference: true },
      });
      return attempt && { reference, amount: attempt.amount, currency: attempt.currency, providerCheckoutReference: attempt.providerCheckoutReference };
    },
  });
  return result.body ? Response.json(result.body, { status: result.status }) : new Response(null, { status: result.status });
}
