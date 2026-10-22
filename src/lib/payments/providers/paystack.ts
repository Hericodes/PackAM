import "server-only";

import { PaystackProviderUnavailableError, ProviderRejectedError } from "../payment-errors";
import { parsePaystackConfig, toKobo, type PaystackTransaction } from "./paystack-core";

/**
 * Paystack REST calls, server-side only. The secret key is read from the environment on each call and
 * never leaves the server. Docs: https://paystack.com/docs/api/transaction/
 */
const API = "https://api.paystack.co";
const TIMEOUT_MS = 15_000;

export function paystackConfig() {
  return parsePaystackConfig(process.env);
}

async function request<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  const { secretKey } = paystackConfig();
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    // Network failure or timeout: the payment state is unknown, so this must stay retryable.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new PaystackProviderUnavailableError(timedOut ? "Paystack request timed out." : "Paystack could not be reached.");
  }
  let result: unknown;
  try { result = await response.json(); } catch { throw new PaystackProviderUnavailableError("Paystack returned an unreadable response."); }
  const body = result as { status?: unknown; message?: unknown; data?: unknown } | null;
  // 4xx with status:false is Paystack declining the request (e.g. an unknown reference); 5xx/429 are retryable outages.
  if (response.status >= 500 || response.status === 429) throw new PaystackProviderUnavailableError(`Paystack request failed with HTTP ${response.status}.`);
  if (!response.ok || !body || body.status !== true) throw new ProviderRejectedError(String(response.status), "Paystack");
  return body as T;
}

export type PaystackInitializeInput = {
  reference: string;
  amount: number; // whole NGN; sent to Paystack in kobo
  email: string;
  callbackUrl: string;
  metadata: Record<string, string>;
};

/** Initialises a transaction and returns Paystack's hosted checkout URL. */
export async function initializePaystackTransaction(input: PaystackInitializeInput) {
  const result = await request<{ data?: { authorization_url?: string; access_code?: string; reference?: string } }>("/transaction/initialize", {
    method: "POST",
    body: { email: input.email, amount: toKobo(input.amount), currency: "NGN", reference: input.reference, callback_url: input.callbackUrl, metadata: input.metadata },
  });
  const data = result.data;
  if (!data?.authorization_url || !data.access_code || data.reference !== input.reference) {
    throw new PaystackProviderUnavailableError("Paystack returned an incomplete initialise response.");
  }
  const url = new URL(data.authorization_url);
  if (url.protocol !== "https:" || !/(^|\.)paystack\.com$/.test(url.hostname)) {
    throw new PaystackProviderUnavailableError("Paystack returned an unexpected checkout URL.");
  }
  return { checkoutUrl: url.toString(), providerCheckoutReference: data.access_code };
}

/** The authoritative transaction record (Verify Transaction API). */
export async function queryPaystackTransaction(reference: string): Promise<PaystackTransaction> {
  const result = await request<{ data?: PaystackTransaction }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });
  if (!result.data) throw new PaystackProviderUnavailableError("Paystack verify response is missing transaction details.");
  return result.data;
}
