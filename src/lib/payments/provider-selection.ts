/**
 * Which payment provider new checkouts use. Pure, so it is unit-tested.
 *
 * - PAYMENT_PROVIDER=PAYSTACK or MANUAL switches *new* checkouts to Paystack or manual bank transfer; anything else (or unset) keeps OPay,
 *   so deploying this code never moves live traffic by itself.
 * - An existing payment attempt always continues with the provider it was created with: its checkout
 *   link, status checks, webhooks and review all use that provider.
 */
export const SUPPORTED_PROVIDERS = ["OPAY", "PAYSTACK", "MANUAL"] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export function activeCheckoutProvider(env: Record<string, string | undefined>): SupportedProvider {
  const chosen = env.PAYMENT_PROVIDER?.trim().toUpperCase();
  if (chosen === "PAYSTACK") return "PAYSTACK";
  // MANUAL: students pay PackAM's bank account and an admin confirms the credit by hand (marketplace and food).
  if (chosen === "MANUAL") return "MANUAL";
  return "OPAY";
}

/**
 * Printing has no manual-transfer screen yet, so while marketplace checkout runs on MANUAL, print payments keep
 * using the gateway they used before (OPay, or Paystack when PAYMENT_PROVIDER=PAYSTACK).
 */
export function activePrintCheckoutProvider(env: Record<string, string | undefined>): Exclude<SupportedProvider, "MANUAL"> {
  const active = activeCheckoutProvider(env);
  return active === "MANUAL" ? "OPAY" : active;
}

export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

export const PROVIDER_NAMES: Record<SupportedProvider, string> = { OPAY: "OPay", PAYSTACK: "Paystack", MANUAL: "bank transfer" };

export function providerName(provider: string | null | undefined) {
  return provider && isSupportedProvider(provider) ? PROVIDER_NAMES[provider] : "our payment partner";
}
