/**
 * Paystack webhook handling on top of the shared provider verification core (opay-verification.ts).
 *
 * Order of checks: HMAC-SHA512 signature over the raw body → event type → PackAM attempt lookup →
 * Paystack Verify API (the only authority) → shared, idempotent finalisation. Responses follow
 * Paystack's retry contract: 200 means handled (applied, safely ignored, or sent to review), anything
 * else means "retry later".
 *
 * Dependencies are injected so the logic is testable without a database or network.
 */
import { describePaymentError } from "./payment-errors";
import { parsePaystackWebhook, verifyPaystackSignature, verifyPaystackTransaction, type PaystackTransaction } from "./providers/paystack-core";
import { referenceTail, routeVerificationError, verifyAndApplyOpayPayment, type PaymentAttemptForVerification, type VerificationDeps } from "./opay-verification";

type HandlerResponse = { status: number; body?: Record<string, unknown> };

/** Paystack's record rules, plugged into the shared verification core. */
export const paystackRecordRules: Pick<VerificationDeps<PaystackTransaction>, "verifyTransaction" | "provider"> = {
  provider: "PAYSTACK",
  verifyTransaction: (transaction, expected) => verifyPaystackTransaction(transaction, expected),
};

export type PaystackWebhookDeps = VerificationDeps<PaystackTransaction> & {
  /** Returns the secret key used to sign webhooks; throws if Paystack isn't configured. */
  secretKey: () => string;
  findAttempt: (reference: string) => Promise<PaymentAttemptForVerification | null>;
};

/** Only a successful charge needs action; every other event is acknowledged and ignored. */
const ACTIONABLE_EVENTS = new Set(["charge.success"]);

export async function handlePaystackWebhook(rawBody: string, signature: string | null, deps: PaystackWebhookDeps): Promise<HandlerResponse> {
  let secretKey: string;
  try {
    secretKey = deps.secretKey();
  } catch (error) {
    // Nothing can be authenticated yet, so nothing may be applied; ask Paystack to retry later.
    deps.log.error("paystack_webhook_unconfigured", describePaymentError(error));
    return { status: 503, body: { error: "Webhook could not be verified yet." } };
  }
  if (!verifyPaystackSignature(rawBody, signature, secretKey)) {
    deps.log.warn("paystack_webhook_signature_rejected", {});
    return { status: 401, body: { error: "Invalid signature." } };
  }
  const event = parsePaystackWebhook(rawBody);
  if (!event) return { status: 400, body: { error: "Invalid webhook." } };
  const reference = event.data.reference;
  if (!ACTIONABLE_EVENTS.has(event.event)) {
    deps.log.info("paystack_webhook_ignored", { event: event.event, refTail: referenceTail(reference) });
    return { status: 200 };
  }

  let attempt: PaymentAttemptForVerification | null;
  try {
    attempt = await deps.findAttempt(reference);
  } catch (error) {
    deps.log.warn("paystack_webhook_lookup_failed", { refTail: referenceTail(reference), ...describePaymentError(error) });
    return { status: 503, body: { error: "Webhook could not be processed yet." } };
  }
  if (!attempt) {
    deps.log.error("paystack_webhook_unknown_reference", { refTail: referenceTail(reference) });
    return { status: 200 };
  }

  try {
    // The webhook's own amount and status are never trusted: the Verify API decides.
    await verifyAndApplyOpayPayment(attempt, deps, { callbackTransactionId: event.data.id !== undefined ? String(event.data.id) : undefined });
    return { status: 200 };
  } catch (error) {
    const routed = await routeVerificationError(error, reference, "paystack verification mismatch", deps);
    return routed.underReview ? { status: 200 } : { status: 503, body: { error: "Webhook could not be processed yet." } };
  }
}
