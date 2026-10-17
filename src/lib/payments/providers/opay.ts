import "server-only";

import { PaymentProvider } from "@prisma/client";
import { signOpayApiPayload, verifyOpayCallbackSignature } from "./opay-signature";
import { mapProviderStatus, toOpayMinorUnits, verifyOpayTransaction, type OpayTransaction } from "./opay-money";
import { OpayConfigurationError, OpayProviderRejectedError, OpayProviderUnavailableError } from "../payment-errors";

export { mapProviderStatus };

const CASHIER_PATH = "/api/v1/international/cashier";
const CREATE_PATH = `${CASHIER_PATH}/create`;
const STATUS_PATH = `${CASHIER_PATH}/status`;

type OpayConfig = {
  merchantId: string;
  publicKey: string;
  secretKey: string;
  baseUrl: string;
};

function getConfig(): OpayConfig {
  const merchantId = process.env.OPAY_MERCHANT_ID;
  const publicKey = process.env.OPAY_PUBLIC_KEY;
  const secretKey = process.env.OPAY_SECRET_KEY;
  const environment = process.env.OPAY_ENVIRONMENT || "sandbox";
  if (!merchantId || !publicKey || !secretKey) {
    throw new OpayConfigurationError("OPay is not configured. Set OPAY_MERCHANT_ID, OPAY_PUBLIC_KEY, and OPAY_SECRET_KEY.");
  }
  if (environment !== "sandbox" && environment !== "production") {
    throw new OpayConfigurationError("OPAY_ENVIRONMENT must be sandbox or production.");
  }
  return {
    merchantId,
    publicKey,
    secretKey,
    // PackAM uses OPay's Nigeria (NGN) merchant environment. The Egypt/global
    // documentation lists different hosts, so keep the region-specific hosts here.
    baseUrl: environment === "production" ? "https://liveapi.opaycheckout.com" : "https://testapi.opaycheckout.com",
  };
}

async function post<T>(path: string, payload: unknown, authorization: string, config: OpayConfig): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${authorization}`,
        MerchantId: config.merchantId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (error) {
    // Network failure or the 15s timeout: the payment state is unknown, so this must stay retryable.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new OpayProviderUnavailableError(timedOut ? "OPay request timed out." : "OPay could not be reached.");
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new OpayProviderUnavailableError("OPay returned an unreadable response.");
  }
  if (!response.ok || !result || typeof result !== "object") {
    throw new OpayProviderUnavailableError(`OPay request failed with HTTP ${response.status}.`);
  }
  return result as T;
}

function successfulResponse(result: { code?: string; message?: string }) {
  if (result.code !== "00000") throw new OpayProviderRejectedError(result.code ?? "unknown");
}

export type CashierCreateInput = {
  reference: string;
  amount: number; // PackAM stores whole NGN; OPay expects the minor unit (kobo).
  productName?: string;
  productDescription: string;
  customer: { id: string; name: string; email: string; phone?: string };
  returnUrl: string;
  callbackUrl: string;
  cancelUrl: string;
};

export async function createCashierPayment(input: CashierCreateInput) {
  const config = getConfig();
  const payload = {
    country: "NG",
    reference: input.reference,
    amount: { total: toOpayMinorUnits(input.amount), currency: "NGN" },
    returnUrl: input.returnUrl,
    callbackUrl: input.callbackUrl,
    cancelUrl: input.cancelUrl,
    expireAt: 30,
    userInfo: {
      userId: input.customer.id,
      userName: input.customer.name || input.customer.email,
      userEmail: input.customer.email,
      ...(input.customer.phone ? { userMobile: input.customer.phone } : {}),
    },
    product: { name: input.productName ?? "PackAM campus order", description: input.productDescription.slice(0, 250) },
  };
  const result = await post<{
    code?: string;
    message?: string;
    data?: { reference?: string; orderNo?: string; cashierUrl?: string; status?: string; amount?: { total?: number; currency?: string } };
  }>(CREATE_PATH, payload, config.publicKey, config);
  successfulResponse(result);
  const data = result.data;
  if (!data?.cashierUrl || data.reference !== input.reference || !data.orderNo) {
    throw new Error("OPay returned an incomplete cashier response.");
  }
  const cashierUrl = new URL(data.cashierUrl);
  const allowedHost = process.env.OPAY_ENVIRONMENT === "production" ? "cashier.opaycheckout.com" : "sandboxcashier.opaycheckout.com";
  if (cashierUrl.protocol !== "https:" || cashierUrl.hostname !== allowedHost) {
    throw new Error("OPay returned an invalid cashier URL.");
  }
  return { cashierUrl: cashierUrl.toString(), providerCheckoutReference: data.orderNo };
}

type ProviderTransaction = OpayTransaction;

export async function queryPaymentStatus(reference: string): Promise<ProviderTransaction> {
  const config = getConfig();
  const payload = { country: "NG", reference };
  const signature = signOpayApiPayload(payload, config.secretKey);
  const result = await post<{
    code?: string;
    message?: string;
    data?: ProviderTransaction;
  }>(STATUS_PATH, payload, signature, config);
  successfulResponse(result);
  if (!result.data) throw new OpayProviderUnavailableError("OPay status response is missing transaction details.");
  return result.data;
}

export function verifyPayment(
  transaction: ProviderTransaction,
  expected: { reference: string; amount: number; currency: string; providerCheckoutReference?: string | null },
) {
  return verifyOpayTransaction(transaction, expected);
}

export function verifyCallbackSignature(input: {
  payload: { amount: string; currency: string; reference: string; refunded: boolean; status: string; timestamp: string; token?: string; transactionId: string };
  sha512: string;
}) {
  const config = getConfig();
  return verifyOpayCallbackSignature(input.payload, input.sha512, config.secretKey);
}

export const OPAY_PAYMENT_PROVIDER = PaymentProvider.OPAY;
