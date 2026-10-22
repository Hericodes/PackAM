/**
 * Paystack rules with no network or database access, so they are unit-tested directly.
 *
 * Trust model (same as OPay):
 * - A webhook is only a signed *trigger*. Its body is authenticated with HMAC-SHA512 over the raw
 *   request bytes, then PackAM re-fetches the transaction from Paystack's Verify API and trusts only that.
 * - A browser redirect (callback_url with ?reference=) is never evidence of payment.
 * - Amounts are whole naira in PackAM and kobo at Paystack; both sides are compared exactly.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PaystackConfigurationError, PaystackVerificationMismatchError } from "../payment-errors";

export function toKobo(amountInNaira: number) {
  if (!Number.isSafeInteger(amountInNaira) || amountInNaira <= 0 || amountInNaira > Math.floor(Number.MAX_SAFE_INTEGER / 100)) {
    throw new Error("PackAM payment amount must be a positive whole-naira amount.");
  }
  return amountInNaira * 100;
}

/**
 * Valid only if `signature` is the hex HMAC-SHA512 of the exact raw body with the secret key.
 * Constant-time comparison; any missing or malformed input is simply invalid.
 */
export function verifyPaystackSignature(rawBody: string, signature: string | null | undefined, secretKey: string) {
  if (!signature || !secretKey || !/^[0-9a-f]{128}$/i.test(signature.trim())) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature.trim(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Paystack transaction statuses → PackAM. Only "success" is paid and only "failed" is a final failure.
 * "abandoned" means the customer hasn't finished yet and can still pay on the same page, so it stays
 * pending, as do "ongoing", "pending", "processing", "queued" and anything unrecognised.
 * "reversed" is a paid transaction that was reversed: never treated as paid or failed automatically.
 */
export function mapPaystackStatus(status: unknown): "SUCCESS" | "FAILED" | "PENDING" | "REVERSED" {
  const normalized = typeof status === "string" ? status.toLowerCase() : "";
  if (normalized === "success") return "SUCCESS";
  if (normalized === "failed") return "FAILED";
  if (normalized === "reversed") return "REVERSED";
  return "PENDING";
}

/** The fields PackAM reads from Paystack's Verify Transaction response `data`. */
export type PaystackTransaction = {
  id?: number | string;
  status?: string;
  reference?: string;
  amount?: number | string;
  currency?: string;
  gateway_response?: string;
};

/**
 * Checks Paystack's verified record against the attempt. Disagreement on reference, amount or currency
 * throws a mismatch (sent to manual review); a success also needs Paystack's transaction id.
 */
export function verifyPaystackTransaction(
  transaction: PaystackTransaction,
  expected: { reference: string; amount: number; currency: string },
) {
  if (transaction.reference !== expected.reference) throw new PaystackVerificationMismatchError("Paystack reference does not match the payment attempt.");
  const amount = Number(transaction.amount);
  if (!Number.isSafeInteger(amount) || amount !== toKobo(expected.amount)) throw new PaystackVerificationMismatchError("Paystack amount does not match the payment attempt.");
  const currency = (transaction.currency ?? "").toUpperCase();
  if (currency !== expected.currency.toUpperCase() || currency !== "NGN") throw new PaystackVerificationMismatchError("Paystack currency does not match the payment attempt.");
  const status = mapPaystackStatus(transaction.status);
  if (status === "REVERSED") throw new PaystackVerificationMismatchError("Paystack reports this transaction as reversed.");
  const providerReference = transaction.id !== undefined && transaction.id !== null && String(transaction.id).trim() ? String(transaction.id) : undefined;
  if (status === "SUCCESS" && !providerReference) throw new PaystackVerificationMismatchError("Paystack success response has no transaction id.");
  return { status, providerReference };
}

export type PaystackConfig = { secretKey: string; mode: "test" | "live" };

/**
 * Reads Paystack configuration. Live keys are refused unless PAYSTACK_LIVE_APPROVED=true is set
 * deliberately, so a misplaced live key can't take real money before the account and tests are ready.
 */
export function parsePaystackConfig(env: Record<string, string | undefined>): PaystackConfig {
  const secretKey = env.PAYSTACK_SECRET_KEY?.trim() ?? "";
  if (!secretKey) throw new PaystackConfigurationError("Paystack is not configured. Set PAYSTACK_SECRET_KEY.");
  if (secretKey.startsWith("pk_")) {
    // The public key can't authenticate API calls or verify webhooks; a common mix-up is swapping the two.
    throw new PaystackConfigurationError(`PAYSTACK_SECRET_KEY holds a public key (pk_…). Use the secret key (sk_…) there${env.PAYSTACK_PUBLIC_KEY?.trim().startsWith("sk_") ? " — PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY look swapped" : ""}.`);
  }
  const mode = secretKey.startsWith("sk_live_") ? "live" : secretKey.startsWith("sk_test_") ? "test" : null;
  if (!mode) throw new PaystackConfigurationError("PAYSTACK_SECRET_KEY must be a Paystack secret key (sk_test_… or sk_live_…).");
  if (mode === "live" && env.PAYSTACK_LIVE_APPROVED !== "true") {
    throw new PaystackConfigurationError("A live Paystack key is set but live payments aren't approved. Use an sk_test_ key, or set PAYSTACK_LIVE_APPROVED=true once Paystack has approved the account.");
  }
  return { secretKey, mode };
}

/** The webhook body fields PackAM reads. Everything else is ignored. */
export type PaystackWebhookEvent = { event: string; data: { reference: string; id?: number | string; status?: string } };

export function parsePaystackWebhook(rawBody: string): PaystackWebhookEvent | null {
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return null; }
  if (!body || typeof body !== "object") return null;
  const record = body as { event?: unknown; data?: unknown };
  if (typeof record.event !== "string" || !record.data || typeof record.data !== "object") return null;
  const data = record.data as { reference?: unknown; id?: unknown; status?: unknown };
  if (typeof data.reference !== "string" || !data.reference || data.reference.length > 100) return null;
  return {
    event: record.event,
    data: {
      reference: data.reference,
      ...(typeof data.id === "number" || typeof data.id === "string" ? { id: data.id } : {}),
      ...(typeof data.status === "string" ? { status: data.status } : {}),
    },
  };
}
