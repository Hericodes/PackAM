/**
 * Cruise Mode's fee only while the delivery-tier tables don't exist yet (fallbackQuoteSet in delivery-tiers.ts). Real
 * prices are DeliveryTierSetting rows; printing uses PRINT_DELIVERY_FEE. Use it nowhere else.
 */
export const CHECKOUT_DELIVERY_FEE = 200;
export const CHECKOUT_CURRENCY = "NGN";
