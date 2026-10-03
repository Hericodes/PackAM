import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesOpayCallbackAmount, toOpayMinorUnits } from "./opay-money";
import { signOpayApiPayload, verifyOpayCallbackSignature } from "./opay-signature";

test("NGN naira amounts are converted to OPay kobo units", () => {
  assert.equal(toOpayMinorUnits(3700), 370000);
  assert.throws(() => toOpayMinorUnits(0));
  assert.throws(() => toOpayMinorUnits(1.5));
});

test("callback amount is compared in whole NGN while Cashier API amount is kobo", () => {
  assert.equal(matchesOpayCallbackAmount("3700", 3700), true);
  assert.equal(matchesOpayCallbackAmount("370000", 3700), false);
  assert.equal(matchesOpayCallbackAmount("3700.00", 3700), false);
});

test("API status signatures use compact alphabetically sorted JSON and HMAC-SHA512", () => {
  const payload = { reference: "packam_test", country: "NG" };
  const sortedJson = '{"country":"NG","reference":"packam_test"}';
  const expected = createHmac("sha512", "test-secret").update(sortedJson).digest("hex");
  assert.equal(signOpayApiPayload(payload, "test-secret"), expected);
});

test("callback signatures use OPay's canonical fields, SHA3-512, and reject tampering", () => {
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
