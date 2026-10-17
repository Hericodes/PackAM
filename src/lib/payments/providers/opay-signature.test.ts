import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCallbackAmount, mapProviderStatus, toOpayMinorUnits, verifyOpayTransaction } from "./opay-money";
import { OpayVerificationMismatchError } from "../payment-errors";
import { signOpayApiPayload, verifyOpayCallbackSignature } from "./opay-signature";

test("NGN naira amounts are converted to OPay kobo units", () => {
  assert.equal(toOpayMinorUnits(3700), 370000);
  assert.throws(() => toOpayMinorUnits(0));
  assert.throws(() => toOpayMinorUnits(1.5));
});

// OPay's Nigeria callback docs do not state the amount unit, so the callback amount is only described
// for logs. Both readings are recognised; neither can accept or reject a payment.
test("callback amount is described as naira or kobo for diagnostics, never trusted", () => {
  assert.equal(describeCallbackAmount("3700", 3700), "naira");
  assert.equal(describeCallbackAmount("370000", 3700), "kobo");
  assert.equal(describeCallbackAmount("3700.00", 3700), "unrecognised");
  assert.equal(describeCallbackAmount("0", 3700), "unrecognised");
});

test("provider statuses map to PENDING, SUCCESS or FAILED and unknown states never fail", () => {
  assert.equal(mapProviderStatus("SUCCESS"), "SUCCESS");
  assert.equal(mapProviderStatus("CLOSE"), "FAILED");
  assert.equal(mapProviderStatus("FAIL"), "FAILED");
  assert.equal(mapProviderStatus("INITIAL"), "PENDING");
  assert.equal(mapProviderStatus("PENDING"), "PENDING");
  assert.equal(mapProviderStatus("SOMETHING_NEW"), "PENDING");
  assert.equal(mapProviderStatus(undefined), "PENDING");
});

test("verified OPay transactions must match the reference, cashier reference, amount and currency", () => {
  const expected = { reference: "packam_print", amount: 1200, currency: "NGN", providerCheckoutReference: "opay-order-7" };
  const transaction = {
    reference: expected.reference,
    orderNo: expected.providerCheckoutReference,
    transactionId: "opay-transaction-8",
    status: "SUCCESS",
    amount: { total: 120_000, currency: "NGN" },
  };
  assert.deepEqual(verifyOpayTransaction(transaction, expected), {
    status: "SUCCESS",
    providerReference: "opay-transaction-8",
  });
  assert.throws(() => verifyOpayTransaction({ ...transaction, reference: "wrong" }, expected), /reference/i);
  assert.throws(() => verifyOpayTransaction({ ...transaction, orderNo: "wrong" }, expected), /order reference/i);
  assert.throws(() => verifyOpayTransaction({ ...transaction, amount: { total: 100, currency: "NGN" } }, expected), /amount/i);
  assert.throws(() => verifyOpayTransaction({ ...transaction, amount: { total: 120_000, currency: "USD" } }, expected), /currency/i);
  assert.throws(() => verifyOpayTransaction({ ...transaction, amount: { total: 120_000, currency: "USD" } }, expected), OpayVerificationMismatchError);
  // A closed checkout has no transaction ID; that is not a mismatch.
  assert.deepEqual(verifyOpayTransaction({ ...transaction, status: "CLOSE", transactionId: undefined }, expected), { status: "FAILED", providerReference: expected.providerCheckoutReference });
  assert.deepEqual(verifyOpayTransaction({ reference: expected.reference, status: "CLOSE", amount: { total: 120_000, currency: "NGN" } }, { ...expected, providerCheckoutReference: null }), { status: "FAILED", providerReference: undefined });
  // A success must still name a provider transaction.
  assert.throws(() => verifyOpayTransaction({ reference: expected.reference, status: "SUCCESS", amount: { total: 120_000, currency: "NGN" } }, { ...expected, providerCheckoutReference: null }), OpayVerificationMismatchError);
});

test("API status signatures use compact alphabetically sorted JSON and HMAC-SHA512", () => {
  const payload = { reference: "packam_test", country: "NG" };
  const sortedJson = '{"country":"NG","reference":"packam_test"}';
  const expected = createHmac("sha512", "test-secret").update(sortedJson).digest("hex");
  assert.equal(signOpayApiPayload(payload, "test-secret"), expected);
});

test("callback signatures use OPay's canonical fields, SHA3-512, and reject tampering", () => {
  // The signature covers the amount string exactly as sent, whatever its unit (naira or kobo).
  const payload = {
    amount: "370000",
    currency: "NGN",
    reference: "packam_test",
    refunded: false,
    status: "SUCCESS",
    timestamp: "2026-10-03T10:00:00Z",
    token: "token-test",
    transactionId: "opay-transaction-test",
  };
  const canonical = '{Amount:"370000",Currency:"NGN",Reference:"packam_test",Refunded:f,Status:"SUCCESS",Timestamp:"2026-10-03T10:00:00Z",Token:"token-test",TransactionID:"opay-transaction-test"}';
  const signature = createHmac("sha3-512", "test-secret").update(canonical).digest("hex");
  assert.equal(verifyOpayCallbackSignature(payload, signature, "test-secret"), true);
  assert.equal(verifyOpayCallbackSignature({ ...payload, amount: "370001" }, signature, "test-secret"), false);
  assert.equal(verifyOpayCallbackSignature(payload, "bad-signature", "test-secret"), false);
});
