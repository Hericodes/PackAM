export function toOpayMinorUnits(amountInNaira: number) {
  if (!Number.isSafeInteger(amountInNaira) || amountInNaira <= 0 || amountInNaira > Math.floor(Number.MAX_SAFE_INTEGER / 100)) {
    throw new Error("PackAM payment amount must be a positive whole-naira amount.");
  }
  return amountInNaira * 100;
}

/** Callback notifications report the transaction amount in whole NGN, unlike Cashier API amount.total (kobo). */
export function matchesOpayCallbackAmount(callbackAmount: string, expectedAmountInNaira: number) {
  return /^\d+$/.test(callbackAmount) && Number(callbackAmount) === expectedAmountInNaira;
}
