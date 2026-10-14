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

type OpayTransaction = {
  reference?: string;
  orderNo?: string;
  transactionId?: string;
  status?: string;
  amount?: { total?: number | string; currency?: string };
  currency?: string;
};

export function verifyOpayTransaction(
  transaction: OpayTransaction,
  expected: { reference: string; amount: number; currency: string; providerCheckoutReference?: string | null },
) {
  const amount = Number(transaction.amount?.total);
  const currency = (transaction.amount?.currency ?? transaction.currency ?? "").toUpperCase();
  if (transaction.reference !== expected.reference) throw new Error("OPay reference does not match the payment attempt.");
  if (expected.providerCheckoutReference && transaction.orderNo !== expected.providerCheckoutReference) {
    throw new Error("OPay order reference does not match the payment attempt.");
  }
  if (!Number.isSafeInteger(amount) || amount !== toOpayMinorUnits(expected.amount)) {
    throw new Error("OPay amount does not match the payment attempt.");
  }
  if (currency !== expected.currency.toUpperCase() || currency !== "NGN") {
    throw new Error("OPay currency does not match the payment attempt.");
  }
  const statusText = typeof transaction.status === "string" ? transaction.status.toUpperCase() : "";
  const status = statusText === "SUCCESS" || statusText === "SUCCESSFUL"
    ? "SUCCESS"
    : ["FAIL", "FAILED", "CLOSE", "CLOSED", "EXPIRED"].includes(statusText)
      ? "FAILED"
      : "PENDING";
  const providerReference = transaction.transactionId ?? transaction.orderNo;
  if (status === "SUCCESS" && !providerReference) throw new Error("OPay success response has no transaction reference.");
  return { status, providerReference };
}
