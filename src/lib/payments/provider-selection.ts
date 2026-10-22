/**
 * Which payment provider new checkouts use. Pure, so it is unit-tested.
 *
 * - PAYMENT_PROVIDER=PAYSTACK switches *new* checkouts to Paystack; anything else (or unset) keeps OPay,
 *   so deploying this code never moves live traffic by itself.
 * - An existing payment attempt always continues with the provider it was created with: its checkout
 *   link, status checks, webhooks and review all use that provider.
 */
export const SUPPORTED_PROVIDERS = ["OPAY", "PAYSTACK"] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export function activeCheckoutProvider(env: Record<string, string | undefined>): SupportedProvider {
  return env.PAYMENT_PROVIDER?.trim().toUpperCase() === "PAYSTACK" ? "PAYSTACK" : "OPAY";
}

export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

export const PROVIDER_NAMES: Record<SupportedProvider, string> = { OPAY: "OPay", PAYSTACK: "Paystack" };

export function providerName(provider: string | null | undefined) {
  return provider && isSupportedProvider(provider) ? PROVIDER_NAMES[provider] : "our payment partner";
}
