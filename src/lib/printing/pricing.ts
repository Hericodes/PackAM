import { PrintColorMode, PrintPaperSize, PrintSides } from "@prisma/client";
import { CHECKOUT_CURRENCY } from "../checkout-pricing";
import { PRINTING_LIMITS, PRINTING_PRICING_VERSION } from "./limits";

export { PRINTING_LIMITS, PRINTING_PRICING_VERSION } from "./limits";
export { parsePageSelection } from "./page-selection";
export type { PageSelection } from "./page-selection";

export const PRINTING_PRICES = {
  A4: {
    BLACK_AND_WHITE: 100,
    COLOR: 300,
  },
} as const satisfies Record<PrintPaperSize, Record<PrintColorMode, number>>;

/**
 * Printing's own flat delivery fee in whole naira. Independent of the marketplace and food delivery tiers:
 * tier settings never change what a print job costs. Every saved print snapshot was priced with this value
 * and payment-snapshot.ts checks it exactly, so never change it without a new PRINTING_PRICING_VERSION.
 */
export const PRINT_DELIVERY_FEE = 200;

export function calculatePrintPrice(input: {
  selectedPageCount: number;
  copies: number;
  paperSize: PrintPaperSize;
  colorMode: PrintColorMode;
  sides: PrintSides;
}) {
  if (!Number.isSafeInteger(input.copies) || input.copies < 1 || input.copies > PRINTING_LIMITS.copies) {
    throw new Error(`Choose between 1 and ${PRINTING_LIMITS.copies} copies.`);
  }
  if (!Number.isSafeInteger(input.selectedPageCount) || input.selectedPageCount < 1 || input.selectedPageCount > PRINTING_LIMITS.pages) {
    throw new Error("Select at least one valid page.");
  }
  const ratePerPage = PRINTING_PRICES[input.paperSize][input.colorMode];
  const printSubtotal = input.selectedPageCount * input.copies * ratePerPage;
  const deliveryFee = PRINT_DELIVERY_FEE;
  const total = printSubtotal + deliveryFee;
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error("The print-job total is invalid.");
  return {
    currency: CHECKOUT_CURRENCY,
    pricingVersion: PRINTING_PRICING_VERSION,
    ratePerPage,
    selectedPageCount: input.selectedPageCount,
    copies: input.copies,
    printSubtotal,
    deliveryFee,
    total,
  };
}
