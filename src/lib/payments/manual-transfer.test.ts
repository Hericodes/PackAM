import assert from "node:assert/strict";
import test from "node:test";
import { checkReceivedAmount, generateTransferCode, isManualTransferExpired, manualTransferAccount, manualTransferDeadline, manualTransferView, transferResultPath } from "./manual-transfer";
import { activeCheckoutProvider, activePrintCheckoutProvider, providerName, isSupportedProvider } from "./provider-selection";

test("transfer codes are PK- plus five unambiguous characters", () => {
  let n = 0;
  const code = generateTransferCode(() => (n += 7) % 31);
  assert.match(code, /^PK-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
  for (let i = 0; i < 200; i += 1) assert.match(generateTransferCode((max) => Math.floor(Math.random() * max)), /^PK-[^01ILO]{5}$/);
});

test("the pay-to account needs every field and a 10-digit number", () => {
  const full = { MANUAL_TRANSFER_BANK_NAME: " OPay ", MANUAL_TRANSFER_ACCOUNT_NUMBER: "81 2345 6789", MANUAL_TRANSFER_ACCOUNT_NAME: "PackAM Ventures" };
  assert.deepEqual(manualTransferAccount(full), { bankName: "OPay", accountNumber: "8123456789", accountName: "PackAM Ventures" });
  assert.equal(manualTransferAccount({}), null);
  assert.equal(manualTransferAccount({ ...full, MANUAL_TRANSFER_ACCOUNT_NUMBER: "12345" }), null);
  assert.equal(manualTransferAccount({ ...full, MANUAL_TRANSFER_ACCOUNT_NUMBER: "81234567ab" }), null);
  assert.equal(manualTransferAccount({ ...full, MANUAL_TRANSFER_BANK_NAME: "  " }), null);
  assert.equal(manualTransferAccount({ ...full, MANUAL_TRANSFER_ACCOUNT_NAME: undefined }), null);
});

test("the student view carries the code, amount, deadline and whether they said they paid", () => {
  const account = { bankName: "OPay", accountNumber: "8123456789", accountName: "PackAM" };
  const createdAt = new Date("2026-11-03T09:00:00Z");
  assert.equal(manualTransferView(account, { transferCode: null, amount: 4500, transferClaimedAt: null, createdAt }), null);
  assert.deepEqual(manualTransferView(account, { transferCode: "PK-ABCDE", amount: 4500, transferClaimedAt: null, createdAt }), { ...account, code: "PK-ABCDE", amount: 4500, claimed: false, payBy: "2026-11-03T09:30:00.000Z" });
  assert.equal(manualTransferView(account, { transferCode: "PK-ABCDE", amount: 4500, transferClaimedAt: new Date(), createdAt })?.claimed, true);
});

test("an unclaimed transfer closes 30 minutes plus 5 minutes' grace after checkout; a claimed one never does", () => {
  const createdAt = new Date("2026-11-03T09:00:00Z");
  const at = (minutes: number) => new Date(createdAt.getTime() + minutes * 60_000);
  assert.equal(manualTransferDeadline(createdAt).toISOString(), "2026-11-03T09:30:00.000Z");
  assert.equal(isManualTransferExpired({ createdAt, transferClaimedAt: null }, at(30)), false, "the grace covers a transfer sent at the deadline");
  assert.equal(isManualTransferExpired({ createdAt, transferClaimedAt: null }, at(34.9)), false);
  assert.equal(isManualTransferExpired({ createdAt, transferClaimedAt: null }, at(35)), true);
  assert.equal(isManualTransferExpired({ createdAt, transferClaimedAt: at(10) }, at(600)), false, "money may already be in the account");
});

test("an admin can't confirm less than the order amount", () => {
  assert.deepEqual(checkReceivedAmount(4500, 4500), { ok: true, extra: 0 });
  assert.deepEqual(checkReceivedAmount(5000, 4500), { ok: true, extra: 500 });
  for (const bad of [4499, 0, -4500, 4500.5, Number.NaN, "4500", null, undefined]) {
    const result = checkReceivedAmount(bad, 4500);
    assert.equal(result.ok, false, `expected ${String(bad)} to be refused`);
  }
  const under = checkReceivedAmount(4000, 4500);
  assert.equal(under.ok === false && /4,000/.test(under.error) && /4,500/.test(under.error), true);
});

test("the result path carries the reference safely", () => {
  assert.equal(transferResultPath("packam_abc-123"), "/checkout/payment-result?reference=packam_abc-123");
  assert.equal(transferResultPath("a b&c"), "/checkout/payment-result?reference=a%20b%26c");
});

test("PAYMENT_PROVIDER=MANUAL switches new checkouts; printing keeps its gateway", () => {
  assert.equal(activeCheckoutProvider({ PAYMENT_PROVIDER: "manual" }), "MANUAL");
  assert.equal(activeCheckoutProvider({ PAYMENT_PROVIDER: " MANUAL " }), "MANUAL");
  assert.equal(activeCheckoutProvider({}), "OPAY");
  assert.equal(activeCheckoutProvider({ PAYMENT_PROVIDER: "PAYSTACK" }), "PAYSTACK");
  assert.equal(activePrintCheckoutProvider({ PAYMENT_PROVIDER: "MANUAL" }), "OPAY");
  assert.equal(activePrintCheckoutProvider({ PAYMENT_PROVIDER: "PAYSTACK" }), "PAYSTACK");
  assert.equal(activePrintCheckoutProvider({}), "OPAY");
  assert.equal(isSupportedProvider("MANUAL"), true);
  assert.equal(providerName("MANUAL"), "bank transfer");
});
