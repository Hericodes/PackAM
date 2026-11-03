import "server-only";

import { PaymentProvider } from "@prisma/client";
import { completeVerifiedPayment, failPendingPayment, markPaymentNeedsReview } from "./payment-lifecycle";
import { consolePaymentLogger, type VerificationDeps } from "./opay-verification";
import { paystackRecordRules } from "./paystack-verification";
import { activeCheckoutProvider, activePrintCheckoutProvider, isSupportedProvider, type SupportedProvider } from "./provider-selection";
import { createCashierPayment, queryPaymentStatus } from "./providers/opay";
import { initializePaystackTransaction, queryPaystackTransaction } from "./providers/paystack";

/** The trusted OPay verification used by status checks, webhooks, cancellation and admin review. */
export const opayStatusDeps: VerificationDeps = {
  provider: "OPAY",
  queryStatus: queryPaymentStatus,
  complete: (verified) => completeVerifiedPayment({ ...verified, provider: PaymentProvider.OPAY, status: "SUCCESS" }),
  fail: failPendingPayment,
  markReview: markPaymentNeedsReview,
  log: consolePaymentLogger,
};

/** The same trusted flow for Paystack: Verify Transaction API record, Paystack's record rules. */
export const paystackStatusDeps: VerificationDeps = {
  ...(paystackRecordRules as Pick<VerificationDeps, "verifyTransaction" | "provider">),
  queryStatus: queryPaystackTransaction,
  complete: (verified) => completeVerifiedPayment({ ...verified, provider: PaymentProvider.PAYSTACK, status: "SUCCESS" }),
  fail: failPendingPayment,
  markReview: markPaymentNeedsReview,
  log: consolePaymentLogger,
};

/**
 * Manual bank transfer has no provider to ask: only an admin confirming the credit in the bank app can complete it
 * (confirmManualPayment). Every automatic check (status poll, student cancel, admin "retry verification") therefore
 * sees "still pending" and changes nothing, and nothing here can ever complete a payment.
 */
export const manualStatusDeps: VerificationDeps = {
  provider: "MANUAL",
  queryStatus: async () => ({ status: "PENDING" }),
  verifyTransaction: () => ({ status: "PENDING" }),
  complete: async () => { throw new Error("Manual payments are completed only by an admin confirming the transfer."); },
  fail: failPendingPayment,
  markReview: markPaymentNeedsReview,
  log: consolePaymentLogger,
};

/** Verification for an existing attempt: always the provider it was created with. */
export function verificationDepsFor(provider: string): VerificationDeps {
  if (provider === "MANUAL") return manualStatusDeps;
  if (provider === "PAYSTACK") return paystackStatusDeps;
  if (provider === "OPAY") return opayStatusDeps;
  throw new Error(`Payment provider ${provider} is not supported for verification.`);
}

export function checkoutProvider(): SupportedProvider {
  return activeCheckoutProvider(process.env);
}

/** Print payments: never MANUAL (no transfer screen for printing yet); see activePrintCheckoutProvider. */
export function printCheckoutProvider(): Exclude<SupportedProvider, "MANUAL"> {
  return activePrintCheckoutProvider(process.env);
}

export type CheckoutInput = {
  reference: string;
  amount: number;
  productName: string;
  description: string;
  customer: { id: string; name: string; email: string; phone?: string };
  /** Where the student lands afterwards, e.g. /checkout/payment-result. */
  returnPath: string;
  /** Extra query PackAM needs on return for OPay; Paystack appends ?reference= itself. */
  returnQuery?: Record<string, string>;
  baseUrl: URL;
  metadata: Record<string, string>;
};

/** Creates the hosted checkout for an attempt, with that attempt's provider. */
export async function createHostedCheckout(provider: string, input: CheckoutInput): Promise<{ checkoutUrl: string; providerCheckoutReference: string }> {
  if (!isSupportedProvider(provider)) throw new Error(`Payment provider ${provider} is not supported for checkout.`);
  // A manual transfer has no hosted checkout; its screen is PackAM's own payment-result page.
  if (provider === "MANUAL") throw new Error("Manual bank transfer has no hosted checkout.");
  if (provider === "PAYSTACK") {
    return initializePaystackTransaction({
      reference: input.reference,
      amount: input.amount,
      email: input.customer.email,
      // No query string: Paystack appends ?trxref=…&reference=… to the callback URL.
      callbackUrl: new URL(input.returnPath, input.baseUrl).toString(),
      metadata: { ...input.metadata, customerId: input.customer.id },
    });
  }
  const returnUrl = new URL(input.returnPath, input.baseUrl);
  for (const [key, value] of Object.entries(input.returnQuery ?? {})) returnUrl.searchParams.set(key, value);
  const result = await createCashierPayment({
    reference: input.reference,
    amount: input.amount,
    productName: input.productName,
    productDescription: input.description,
    customer: input.customer,
    returnUrl: returnUrl.toString(),
    cancelUrl: returnUrl.toString(),
    callbackUrl: new URL("/api/webhooks/opay", input.baseUrl).toString(),
  });
  return { checkoutUrl: result.cashierUrl, providerCheckoutReference: result.providerCheckoutReference };
}
