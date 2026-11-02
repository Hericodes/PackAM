/**
 * Rules for checkout's delivery-speed step. Pure, so they are unit-tested (like checkout-location-step.ts).
 *
 * The student's choice is never changed for them: a speed is preselected once, when checkout opens (Cruise Mode
 * when it's on sale), and after that only the student changes it. If the chosen speed stops being available
 * (an admin turned it off, or the server refused it) it stays chosen and visible, marked unavailable, and Pay waits
 * until they pick another.
 */
import { DELIVERY_TIER_LABELS, type DeliveryTierCode, type DeliveryTierQuote } from "./delivery-tiers";

/** The speed preselected when checkout opens: Cruise Mode if it's on sale, otherwise none (the student chooses). */
export function initialDeliveryTier(quotes: readonly DeliveryTierQuote[]): DeliveryTierCode | null {
  return quotes.some((quote) => quote.tier === "CRUISE" && quote.available) ? "CRUISE" : null;
}

/** Speeds to list: those on sale, plus the chosen one if it stopped being available. Display order is kept. */
export function visibleDeliveryTiers(quotes: readonly DeliveryTierQuote[], selected: DeliveryTierCode | null): DeliveryTierQuote[] {
  return quotes.filter((quote) => quote.available || quote.tier === selected);
}

/** What stops payment at the speed step, in plain words, or null. */
export function deliveryTierProblem(quotes: readonly DeliveryTierQuote[], selected: DeliveryTierCode | null): string | null {
  const chosen = quotes.find((quote) => quote.tier === selected);
  if (chosen?.available) return null;
  if (chosen) return `${chosen.label} isn’t available right now. Choose another delivery speed.`;
  if (selected) return `${DELIVERY_TIER_LABELS[selected]} isn’t available right now. Choose another delivery speed.`;
  return quotes.some((quote) => quote.available) ? "Choose a delivery speed to continue." : "Delivery isn’t available right now. Please try again later.";
}

/**
 * sessionStorage key for a payment attempt. It covers the exact cart, place, instructions, speed, delivery fee and
 * total, so a changed checkout never reuses an attempt made for different terms; the speed is in it because two
 * speeds can cost the same.
 */
export function paymentAttemptStorageKey(input: {
  locationId: string;
  instructions: string;
  items: ReadonlyArray<{ id: string; quantity: number }>;
  tier: DeliveryTierCode;
  deliveryFee: number;
  total: number;
}) {
  const cart = input.items.map((item) => `${item.id}x${item.quantity}`).sort().join(",");
  return `packam-payment-attempt:${input.locationId}:${input.instructions.trim()}:${cart}:${input.tier}:${input.deliveryFee}:${input.total}`;
}
