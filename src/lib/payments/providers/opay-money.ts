import { OpayVerificationMismatchError } from "../payment-errors";

export function toOpayMinorUnits(amountInNaira: number) {
  if (!Number.isSafeInteger(amountInNaira) || amountInNaira <= 0 || amountInNaira > Math.floor(Number.MAX_SAFE_INTEGER / 100)) {
    throw new Error("PackAM payment amount must be a positive whole-naira amount.");
  }
  return amountInNaira * 100;
}

export type OpayStatus = "PENDING" | "SUCCESS" | "FAILED";

export function mapProviderStatus(status: unknown): OpayStatus {
  const normalized = typeof status === "string" ? status.toUpperCase() : "";
  if (normalized === "SUCCESS" || normalized === "SUCCESSFUL") return "SUCCESS";
  if (["FAIL", "FAILED", "CLOSE", "CLOSED", "EXPIRED"].includes(normalized)) return "FAILED";
  // INITIAL, PENDING and anything unrecognised stay pending: never fail what we cannot confirm.
  return "PENDING";
}

/**
 * Diagnostic only. OPay's Nigeria callback docs say "Transaction Amount in NGN" without naming the unit,
 * and the Cashier status API uses kobo. Until a real callback settles it, the callback amount is logged
 * and never used to accept or reject a payment; the signed status query is authoritative.
 */
export function describeCallbackAmount(callbackAmount: string, expectedAmountInNaira: number): "naira" | "kobo" | "unrecognised" {
  if (!/^\d+$/.test(callbackAmount)) return "unrecognised";
  const value = Number(callbackAmount);
  if (value === expectedAmountInNaira) return "naira";
  if (value === expectedAmountInNaira * 100) return "kobo";
  return "unrecognised";
}

export type OpayTransaction = {
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
  if (transaction.reference !== expected.reference) throw new OpayVerificationMismatchError("OPay reference does not match the payment attempt.");
  if (expected.providerCheckoutReference && transaction.orderNo !== expected.providerCheckoutReference) {
    throw new OpayVerificationMismatchError("OPay order reference does not match the payment attempt.");
  }
  if (!Number.isSafeInteger(amount) || amount !== toOpayMinorUnits(expected.amount)) {
    throw new OpayVerificationMismatchError("OPay amount does not match the payment attempt.");
  }
  if (currency !== expected.currency.toUpperCase() || currency !== "NGN") {
    throw new OpayVerificationMismatchError("OPay currency does not match the payment attempt.");
  }
  const status = mapProviderStatus(transaction.status);
  const providerReference = transaction.transactionId ?? transaction.orderNo;
  // Only a success needs a provider transaction; closed or failed checkouts legitimately have none.
  if (status === "SUCCESS" && !providerReference) throw new OpayVerificationMismatchError("OPay success response has no transaction reference.");
  return { status, providerReference };
}
