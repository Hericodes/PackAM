import { createHmac, timingSafeEqual } from "node:crypto";

type CallbackPayload = {
  amount: string;
  currency: string;
  reference: string;
  refunded: boolean;
  status: string;
  timestamp: string;
  token?: string;
  transactionId: string;
};

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

/** OPay API auth: HMAC-SHA512 over alphabetically sorted JSON payload. */
export function signOpayApiPayload(payload: unknown, secretKey: string) {
  return createHmac("sha512", secretKey)
    .update(JSON.stringify(sortJson(payload)), "utf8")
    .digest("hex");
}

/** OPay callback auth: HMAC-SHA3-512 over its documented canonical field string. */
export function verifyOpayCallbackSignature(
  payload: CallbackPayload,
  signature: string,
  secretKey: string,
) {
  if (!/^[a-f\d]{128}$/i.test(signature)) return false;
  const content = `{Amount:"${payload.amount}",Currency:"${payload.currency}",Reference:"${payload.reference}",Refunded:${payload.refunded ? "t" : "f"},Status:"${payload.status}",Timestamp:"${payload.timestamp}",Token:"${payload.token ?? ""}",TransactionID:"${payload.transactionId}"}`;
  const expected = createHmac("sha3-512", secretKey).update(content, "utf8").digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
