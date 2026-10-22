import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { mapPaystackStatus, parsePaystackConfig, parsePaystackWebhook, toKobo, verifyPaystackSignature, verifyPaystackTransaction, type PaystackTransaction } from "./providers/paystack-core";
import { handlePaystackWebhook, paystackRecordRules, type PaystackWebhookDeps } from "./paystack-verification";
import { checkOpayPaymentStatus, type CompletionResult } from "./opay-verification";
import { PaystackProviderUnavailableError, ProviderRejectedError, classifyPaymentError } from "./payment-errors";
import { activeCheckoutProvider, providerName } from "./provider-selection";

const SECRET = "sk_test_unit_secret_key_never_real";
const ATTEMPT = { reference: "packam_paystack-0001", amount: 1300, currency: "NGN", providerCheckoutReference: "access_code_1" };
const sign = (body: string, secret = SECRET) => createHmac("sha512", secret).update(body, "utf8").digest("hex");
const record = (overrides: Partial<PaystackTransaction> = {}): PaystackTransaction => ({ id: 4099260516, status: "success", reference: ATTEMPT.reference, amount: 130_000, currency: "NGN", ...overrides });
const webhookBody = (overrides: { event?: string; reference?: string; id?: number } = {}) => JSON.stringify({ event: overrides.event ?? "charge.success", data: { id: overrides.id ?? 4099260516, reference: overrides.reference ?? ATTEMPT.reference, status: "success", amount: 130_000, currency: "NGN" } });

/**
 * In-memory payment store mirroring the lifecycle: the first verified success finalises once, later
 * ones are idempotent; fail moves only PENDING → FAILED; a FAILED attempt is never finalised.
 */
function harness(verifyApi: PaystackTransaction | (() => PaystackTransaction | Promise<PaystackTransaction>) = record(), initial: "PENDING" | "FAILED" = "PENDING") {
  const state = { status: initial as string, fulfilments: 0, queries: 0, fails: 0, reviews: 0 };
  const deps: PaystackWebhookDeps = {
    ...paystackRecordRules,
    queryStatus: async () => { state.queries++; return typeof verifyApi === "function" ? verifyApi() : verifyApi; },
    complete: async (): Promise<CompletionResult> => {
      if (state.status === "SUCCESS") return { orderId: "order-1", alreadyProcessed: true };
      if (state.status !== "PENDING") throw new Error("Payment attempt is no longer pending.");
      state.status = "SUCCESS"; state.fulfilments++;
      return { orderId: "order-1", alreadyProcessed: false };
    },
    fail: async () => { state.fails++; if (state.status !== "PENDING") return false; state.status = "FAILED"; return true; },
    markReview: async () => { state.reviews++; return true; },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    secretKey: () => SECRET,
    findAttempt: async (reference) => (reference === ATTEMPT.reference ? ATTEMPT : null),
  };
  return { deps, state };
}

// ------------------------------------------------------------------ signatures

test("a webhook signed with HMAC-SHA512 of the raw body is accepted; anything else is not", () => {
  const body = webhookBody();
  assert.equal(verifyPaystackSignature(body, sign(body), SECRET), true);
  assert.equal(verifyPaystackSignature(body, sign(body).toUpperCase(), SECRET), true, "hex case doesn't matter");
  assert.equal(verifyPaystackSignature(body, sign(body, "sk_test_other"), SECRET), false, "wrong secret");
  assert.equal(verifyPaystackSignature(body.replace("130000", "1"), sign(body), SECRET), false, "tampered body");
  assert.equal(verifyPaystackSignature(`${body} `, sign(body), SECRET), false, "re-serialised body");
  for (const bad of [null, undefined, "", "abc", "z".repeat(128), sign(body).slice(0, 64)]) assert.equal(verifyPaystackSignature(body, bad, SECRET), false, String(bad));
  assert.equal(verifyPaystackSignature(body, sign(body, ""), ""), false, "no secret configured");
});

test("invalid signatures are rejected before any lookup or Paystack query", async () => {
  const { deps, state } = harness();
  const body = webhookBody();
  assert.equal((await handlePaystackWebhook(body, sign(body, "sk_test_attacker"), deps)).status, 401);
  assert.equal((await handlePaystackWebhook(body, null, deps)).status, 401);
  assert.equal(state.queries, 0);
  assert.equal(state.fulfilments, 0);
});

// ------------------------------------------------------------------ record verification

test("amounts are compared exactly in kobo, with reference, currency and transaction id", () => {
  assert.equal(toKobo(1300), 130_000);
  assert.throws(() => toKobo(0)); assert.throws(() => toKobo(1.5));
  assert.deepEqual(verifyPaystackTransaction(record(), ATTEMPT), { status: "SUCCESS", providerReference: "4099260516" });
  assert.throws(() => verifyPaystackTransaction(record({ amount: 129_900 }), ATTEMPT), /amount/);
  assert.throws(() => verifyPaystackTransaction(record({ amount: "130000.5" }), ATTEMPT), /amount/);
  assert.throws(() => verifyPaystackTransaction(record({ reference: "packam_someone-else" }), ATTEMPT), /reference/);
  assert.throws(() => verifyPaystackTransaction(record({ currency: "USD" }), ATTEMPT), /currency/);
  assert.throws(() => verifyPaystackTransaction(record({ id: undefined }), ATTEMPT), /transaction id/);
  assert.throws(() => verifyPaystackTransaction(record({ status: "reversed" }), ATTEMPT), /reversed/);
  for (const error of [() => verifyPaystackTransaction(record({ amount: 1 }), ATTEMPT)]) {
    try { error(); } catch (cause) { assert.equal(classifyPaymentError(cause), "mismatch", "mismatches go to manual review"); }
  }
});

test("only 'success' is paid and only 'failed' is a failure; abandoned and in-progress stay pending", () => {
  assert.equal(mapPaystackStatus("success"), "SUCCESS");
  assert.equal(mapPaystackStatus("failed"), "FAILED");
  for (const status of ["abandoned", "ongoing", "pending", "processing", "queued", "", undefined, "SOMETHING_NEW"]) assert.equal(mapPaystackStatus(status), "PENDING", String(status));
  assert.equal(verifyPaystackTransaction(record({ status: "abandoned", id: undefined }), ATTEMPT).status, "PENDING");
  assert.equal(verifyPaystackTransaction(record({ status: "failed" }), ATTEMPT).status, "FAILED");
});

// ------------------------------------------------------------------ webhook processing

test("a signed charge.success is re-verified with Paystack and finalised once", async () => {
  const { deps, state } = harness();
  const body = webhookBody();
  assert.equal((await handlePaystackWebhook(body, sign(body), deps)).status, 200);
  assert.equal(state.queries, 1, "the Verify API, not the webhook body, is the authority");
  assert.deepEqual({ status: state.status, fulfilments: state.fulfilments }, { status: "SUCCESS", fulfilments: 1 });
});

test("duplicate and concurrent webhooks finalise exactly once", async () => {
  const { deps, state } = harness();
  const body = webhookBody();
  const results = await Promise.all([1, 2, 3].map(() => handlePaystackWebhook(body, sign(body), deps)));
  results.push(await handlePaystackWebhook(body, sign(body), deps));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(state.fulfilments, 1);
});

test("a webhook and the student's status poll racing each other finalise once (repeated finalisation)", async () => {
  const { deps, state } = harness();
  const body = webhookBody();
  const [hook, poll, again] = await Promise.all([handlePaystackWebhook(body, sign(body), deps), checkOpayPaymentStatus(ATTEMPT, deps), checkOpayPaymentStatus(ATTEMPT, deps)]);
  assert.equal(hook.status, 200);
  assert.equal(poll.body?.status, "SUCCESS");
  assert.equal(again.body?.status, "SUCCESS");
  assert.equal(state.fulfilments, 1);
});

test("an amount mismatch from the Verify API is flagged for review, never fulfilled, and acknowledged", async () => {
  const { deps, state } = harness(record({ amount: 100 }));
  const body = webhookBody();
  assert.equal((await handlePaystackWebhook(body, sign(body), deps)).status, 200, "acknowledged so Paystack stops retrying");
  assert.equal(state.reviews, 1);
  assert.equal(state.fulfilments, 0);
  assert.equal(state.status, "PENDING");
});

test("a webhook whose transaction id disagrees with the verified record is flagged, not fulfilled", async () => {
  const { deps, state } = harness();
  const body = webhookBody({ id: 1 });
  assert.equal((await handlePaystackWebhook(body, sign(body), deps)).status, 200);
  assert.equal(state.reviews, 1);
  assert.equal(state.fulfilments, 0);
});

test("an unknown or someone else's reference is acknowledged and nothing is applied", async () => {
  const { deps, state } = harness();
  const body = webhookBody({ reference: "packam_not-ours" });
  assert.equal((await handlePaystackWebhook(body, sign(body), deps)).status, 200);
  assert.equal(state.queries, 0);
  assert.equal(state.fulfilments, 0);
});

test("delayed confirmation: still pending at Paystack changes nothing; a later check finalises", async () => {
  let paystack: PaystackTransaction = record({ status: "ongoing", id: undefined });
  const { deps, state } = harness(() => paystack);
  const body = webhookBody();
  assert.equal((await handlePaystackWebhook(body, sign(body), deps)).status, 200);
  assert.equal(state.status, "PENDING", "the webhook claimed success, but the Verify API decides");
  assert.equal(state.fails, 0);
  paystack = record();
  assert.equal((await checkOpayPaymentStatus(ATTEMPT, deps)).body?.status, "SUCCESS");
  assert.equal(state.fulfilments, 1);
});

test("a failed payment is recorded as failed and never fulfilled", async () => {
  const { deps, state } = harness(record({ status: "failed" }));
  assert.equal((await checkOpayPaymentStatus(ATTEMPT, deps)).body?.status, "FAILED");
  assert.deepEqual({ status: state.status, fulfilments: state.fulfilments }, { status: "FAILED", fulfilments: 0 });
});

test("a late success for an attempt already recorded as failed is not fulfilled (out-of-order events)", async () => {
  const { deps, state } = harness(record(), "FAILED");
  const body = webhookBody();
  const result = await handlePaystackWebhook(body, sign(body), deps);
  assert.equal(result.status, 503, "retryable; the lifecycle alerts operations about a success after failure");
  assert.equal(state.fulfilments, 0);
  assert.equal(state.status, "FAILED");
});

test("Paystack outages, errors and missing configuration are retryable and change nothing", async () => {
  for (const failure of [new PaystackProviderUnavailableError("Paystack request timed out."), new ProviderRejectedError("400", "Paystack")]) {
    const { deps, state } = harness(() => { throw failure; });
    const body = webhookBody();
    assert.equal((await handlePaystackWebhook(body, sign(body), deps)).status, 503, failure.name);
    assert.deepEqual({ status: state.status, fails: state.fails, reviews: state.reviews }, { status: "PENDING", fails: 0, reviews: 0 }, "a timeout is not a failure");
    assert.equal((await checkOpayPaymentStatus(ATTEMPT, deps)).status, 503);
  }
  const { deps } = harness();
  const unconfigured = { ...deps, secretKey: () => { throw new Error("Paystack is not configured."); } };
  const body = webhookBody();
  assert.equal((await handlePaystackWebhook(body, sign(body), unconfigured)).status, 503);
});

test("events other than charge.success and malformed bodies are handled safely", async () => {
  const { deps, state } = harness();
  const transfer = webhookBody({ event: "transfer.success" });
  assert.equal((await handlePaystackWebhook(transfer, sign(transfer), deps)).status, 200);
  assert.equal(state.queries, 0);
  for (const bad of ["not json", JSON.stringify({ event: "charge.success" }), JSON.stringify({ event: "charge.success", data: { reference: "" } })]) {
    assert.equal((await handlePaystackWebhook(bad, sign(bad), deps)).status, 400, bad);
    assert.equal(parsePaystackWebhook(bad), null);
  }
});

// ------------------------------------------------------------------ configuration

test("test keys are used by default; live keys are refused until live payments are approved", () => {
  assert.deepEqual(parsePaystackConfig({ PAYSTACK_SECRET_KEY: "sk_test_abc" }), { secretKey: "sk_test_abc", mode: "test" });
  assert.throws(() => parsePaystackConfig({}), /not configured/);
  assert.throws(() => parsePaystackConfig({ PAYSTACK_SECRET_KEY: "pk_test_public_key" }), /secret key/);
  assert.throws(() => parsePaystackConfig({ PAYSTACK_SECRET_KEY: "sk_live_abc" }), /live payments aren.t approved/);
  assert.deepEqual(parsePaystackConfig({ PAYSTACK_SECRET_KEY: "sk_live_abc", PAYSTACK_LIVE_APPROVED: "true" }), { secretKey: "sk_live_abc", mode: "live" });
});

test("a public key in the secret slot is refused and swapped keys are called out", () => {
  assert.throws(() => parsePaystackConfig({ PAYSTACK_SECRET_KEY: "pk_test_abc" }), /holds a public key/);
  assert.throws(() => parsePaystackConfig({ PAYSTACK_SECRET_KEY: "pk_live_abc", PAYSTACK_PUBLIC_KEY: "sk_live_def" }), /look swapped/);
  // The refusal message never repeats either key's value.
  try { parsePaystackConfig({ PAYSTACK_SECRET_KEY: "pk_live_abc123", PAYSTACK_PUBLIC_KEY: "sk_live_def456" }); } catch (error) {
    assert.doesNotMatch(String(error), /abc123|def456/);
  }
});

test("abandoned payments stay pending: never failed, never fulfilled, still payable", async () => {
  const { deps, state } = harness(record({ status: "abandoned", id: undefined }));
  const body = webhookBody();
  assert.equal((await handlePaystackWebhook(body, sign(body), deps)).status, 200);
  const poll = await checkOpayPaymentStatus(ATTEMPT, deps);
  assert.equal(poll.body?.status, "PENDING");
  assert.deepEqual({ status: state.status, fails: state.fails, fulfilments: state.fulfilments }, { status: "PENDING", fails: 0, fulfilments: 0 });
});

test("successful, failed, pending, abandoned and duplicate events end in the right state", async () => {
  const cases: Array<[string, string, number]> = [["success", "SUCCESS", 1], ["failed", "FAILED", 0], ["pending", "PENDING", 0], ["ongoing", "PENDING", 0], ["abandoned", "PENDING", 0]];
  for (const [paystackStatus, expected, fulfilments] of cases) {
    const { deps, state } = harness(record({ status: paystackStatus, ...(paystackStatus === "success" ? {} : { id: paystackStatus === "failed" ? 1 : undefined }) }));
    // Each event delivered twice (Paystack retries), plus a status poll.
    for (let i = 0; i < 2; i += 1) { const body = webhookBody(); await handlePaystackWebhook(body, sign(body), deps); }
    await checkOpayPaymentStatus(ATTEMPT, deps);
    assert.deepEqual({ status: state.status, fulfilments: state.fulfilments }, { status: expected, fulfilments }, paystackStatus);
  }
});

test("OPay stays the active provider unless PAYMENT_PROVIDER=PAYSTACK is set", () => {
  assert.equal(activeCheckoutProvider({}), "OPAY");
  assert.equal(activeCheckoutProvider({ PAYMENT_PROVIDER: "paystack" }), "PAYSTACK");
  assert.equal(activeCheckoutProvider({ PAYMENT_PROVIDER: "stripe" }), "OPAY");
  assert.equal(providerName("PAYSTACK"), "Paystack");
  assert.equal(providerName(null), "our payment partner");
});
