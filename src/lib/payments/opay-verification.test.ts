import assert from "node:assert/strict";
import { test } from "node:test";
import { checkOpayPaymentStatus, handleOpayCallback, type CallbackDeps, type CompletionResult, type PaymentAttemptForVerification } from "./opay-verification";
import { OpayConfigurationError, OpayProviderRejectedError, OpayProviderUnavailableError, PaymentFinalizationMismatchError } from "./payment-errors";
import type { OpayTransaction } from "./providers/opay-money";

const ATTEMPT: PaymentAttemptForVerification = { reference: "packam_test-ref-0001", amount: 1300, currency: "NGN", providerCheckoutReference: "opay-order-1" };
const SECRET_SIGNATURE = "a".repeat(128);
const SECRET_TOKEN = "callback-token-should-not-be-logged";

function callback(overrides: Partial<{ status: string; amount: string; currency: string; transactionId: string; reference: string; refunded: boolean }> = {}) {
  return {
    type: "transaction-status",
    sha512: SECRET_SIGNATURE,
    payload: {
      amount: "130000",
      currency: "NGN",
      reference: ATTEMPT.reference,
      country: "NG",
      refunded: false,
      status: "SUCCESS",
      timestamp: "2026-10-17T10:00:00Z",
      token: SECRET_TOKEN,
      transactionId: "opay-txn-1",
      ...overrides,
    },
  };
}

/** Provider record as the signed Cashier status API returns it (amount in kobo). */
function providerRecord(overrides: Partial<OpayTransaction> = {}): OpayTransaction {
  return { reference: ATTEMPT.reference, orderNo: "opay-order-1", transactionId: "opay-txn-1", status: "SUCCESS", amount: { total: 130_000, currency: "NGN" }, ...overrides };
}

function harness(options: {
  provider?: OpayTransaction | (() => Promise<OpayTransaction>);
  complete?: (input: Parameters<CallbackDeps["complete"]>[0]) => Promise<CompletionResult>;
  attempt?: PaymentAttemptForVerification | null;
  signature?: () => boolean;
} = {}) {
  const calls = { queries: 0, completes: [] as Parameters<CallbackDeps["complete"]>[0][], fails: [] as string[], reviews: [] as { reference: string; reason: string }[], lookups: 0 };
  const logs: { level: string; event: string; fields: Record<string, unknown> }[] = [];
  const failed = new Set<string>();
  const deps: CallbackDeps = {
    verifySignature: options.signature ?? (() => true),
    findAttempt: async () => { calls.lookups++; return options.attempt === undefined ? ATTEMPT : options.attempt; },
    queryStatus: async () => {
      calls.queries++;
      const source = options.provider ?? providerRecord();
      return typeof source === "function" ? source() : source;
    },
    complete: async (input) => {
      calls.completes.push(input);
      return options.complete ? options.complete(input) : { orderId: "order-1", alreadyProcessed: false };
    },
    // Mirrors failPendingPayment: only the first call changes a PENDING attempt.
    fail: async (reference) => { calls.fails.push(reference); if (failed.has(reference)) return false; failed.add(reference); return true; },
    markReview: async (reference, reason) => { calls.reviews.push({ reference, reason }); return true; },
    log: {
      info: (event, fields) => logs.push({ level: "info", event, fields }),
      warn: (event, fields) => logs.push({ level: "warn", event, fields }),
      error: (event, fields) => logs.push({ level: "error", event, fields }),
    },
  };
  return { deps, calls, logs };
}

// 1 ----------------------------------------------------------------------------------------------
test("a signed callback for a provider-confirmed CLOSED checkout with no transaction ID is failed, not flagged", async () => {
  // Mirrors the five real abandoned checkouts: OPay status CLOSE, timeout, no transactionId.
  for (const callbackAmount of ["130000", "1300", "0"]) {
    const { deps, calls } = harness({ provider: providerRecord({ status: "CLOSE", transactionId: undefined }) });
    const response = await handleOpayCallback(callback({ status: "CLOSE", amount: callbackAmount, transactionId: "" }), deps);
    assert.equal(response.status, 200, `callback amount ${callbackAmount}`);
    assert.deepEqual(calls.fails, [ATTEMPT.reference]);
    assert.equal(calls.reviews.length, 0, "a closed checkout must not become a manual-review mismatch");
    assert.equal(calls.completes.length, 0);
  }
});

test("callback amount formatting alone cannot block verification of a FAILED checkout", async () => {
  const { deps, calls } = harness({ provider: providerRecord({ status: "FAIL", transactionId: undefined }) });
  const response = await handleOpayCallback(callback({ status: "FAIL", amount: "13.00" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.fails, [ATTEMPT.reference]);
  assert.equal(calls.reviews.length, 0);
});

// 2 ----------------------------------------------------------------------------------------------
test("a successful callback is finalized only through the signed status query, whatever the callback amount unit", async () => {
  // OPay's v2 callback docs describe cent units; the Nigeria v1 page does not say. Both must work.
  for (const callbackAmount of ["130000", "1300"]) {
    const { deps, calls, logs } = harness();
    const response = await handleOpayCallback(callback({ amount: callbackAmount }), deps);
    assert.equal(response.status, 200);
    assert.equal(calls.queries, 1, "the status API must be queried before finalizing");
    assert.deepEqual(calls.completes, [{ transactionReference: ATTEMPT.reference, providerReference: "opay-txn-1", amount: 1300, currency: "NGN" }]);
    assert.equal(calls.reviews.length, 0);
    const received = logs.find((entry) => entry.event === "opay_callback_received");
    assert.equal(received?.fields.callbackAmountUnit, callbackAmount === "130000" ? "kobo" : "naira");
  }
});

test("a callback alone never finalizes: if the status query says otherwise, the query wins", async () => {
  const { deps, calls } = harness({ provider: providerRecord({ status: "PENDING", transactionId: undefined }) });
  const response = await handleOpayCallback(callback({ status: "SUCCESS" }), deps);
  assert.equal(response.status, 200);
  assert.equal(calls.completes.length, 0);
  assert.equal(calls.fails.length, 0);
});

// 3 ----------------------------------------------------------------------------------------------
test("a genuine verified amount or currency mismatch triggers the reconciliation safeguards", async () => {
  for (const record of [providerRecord({ amount: { total: 120_000, currency: "NGN" } }), providerRecord({ amount: { total: 130_000, currency: "USD" } }), providerRecord({ reference: "packam_someone-else" }), providerRecord({ orderNo: "other-order" })]) {
    const webhook = harness({ provider: record });
    const webhookResponse = await handleOpayCallback(callback(), webhook.deps);
    assert.equal(webhookResponse.status, 200, "flagged mismatches are acknowledged so OPay stops retrying");
    assert.deepEqual(webhook.calls.reviews, [{ reference: ATTEMPT.reference, reason: "provider verification mismatch" }]);
    assert.equal(webhook.calls.completes.length, 0);
    assert.equal(webhook.calls.fails.length, 0);

    const poll = harness({ provider: record });
    const pollResponse = await checkOpayPaymentStatus(ATTEMPT, poll.deps);
    assert.equal(pollResponse.status, 503);
    assert.deepEqual(poll.calls.reviews, [{ reference: ATTEMPT.reference, reason: "provider status mismatch" }]);
    assert.equal(poll.calls.completes.length, 0);
  }
});

test("a verified success that PackAM cannot finalize (snapshot/amount disagreement) is flagged", async () => {
  const { deps, calls } = harness({ complete: async () => { throw new PaymentFinalizationMismatchError("Payment amount does not match the saved checkout snapshot."); } });
  const response = await handleOpayCallback(callback(), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.reviews, [{ reference: ATTEMPT.reference, reason: "provider verification mismatch" }]);
});

test("if flagging a genuine mismatch itself fails, the webhook asks OPay to retry", async () => {
  const { deps } = harness({ provider: providerRecord({ amount: { total: 1, currency: "NGN" } }) });
  deps.markReview = async () => { throw new Error("database unavailable"); };
  assert.equal((await handleOpayCallback(callback(), deps)).status, 503);
});

// 4 ----------------------------------------------------------------------------------------------
test("missing OPay configuration is retryable and never flags the payment", async () => {
  const atSignature = harness({ signature: () => { throw new OpayConfigurationError("OPay is not configured. Set OPAY_MERCHANT_ID, OPAY_PUBLIC_KEY, and OPAY_SECRET_KEY."); } });
  const response = await handleOpayCallback(callback(), atSignature.deps);
  assert.equal(response.status, 503);
  assert.equal(atSignature.calls.lookups, 0);
  assert.equal(atSignature.calls.reviews.length, 0);

  // The old keyword matcher flagged this message because it contains "MERCHANT".
  const atQuery = harness({ provider: async () => { throw new OpayConfigurationError("OPay is not configured. Set OPAY_MERCHANT_ID, OPAY_PUBLIC_KEY, and OPAY_SECRET_KEY."); } });
  assert.equal((await handleOpayCallback(callback(), atQuery.deps)).status, 503);
  assert.equal((await checkOpayPaymentStatus(ATTEMPT, atQuery.deps)).status, 503);
  assert.equal(atQuery.calls.reviews.length, 0);
});

// 5 ----------------------------------------------------------------------------------------------
test("provider network errors, timeouts and rejections are retryable and never flag the payment", async () => {
  const errors = [
    new OpayProviderUnavailableError("OPay request timed out."),
    new OpayProviderUnavailableError("OPay could not be reached."),
    new OpayProviderUnavailableError("OPay request failed with HTTP 502."),
    new OpayProviderRejectedError("02812"),
    // Unclassified errors (e.g. database trouble) whose text happens to contain old trigger words.
    new Error("connection reset while reading reference amount currency merchant"),
  ];
  for (const error of errors) {
    const { deps, calls, logs } = harness({ provider: async () => { throw error; } });
    assert.equal((await handleOpayCallback(callback(), deps)).status, 503, error.message);
    assert.equal((await checkOpayPaymentStatus(ATTEMPT, deps)).status, 503, error.message);
    assert.equal(calls.reviews.length, 0, error.message);
    assert.equal(calls.fails.length, 0, "an unverifiable payment must never be failed");
    assert.ok(logs.some((entry) => entry.event === "opay_verification_retryable"));
  }
});

test("a database error during finalization is retryable, not a mismatch", async () => {
  const { deps, calls } = harness({ complete: async () => { throw new Error("Payment attempt was already claimed."); } });
  assert.equal((await handleOpayCallback(callback(), deps)).status, 503);
  assert.equal(calls.reviews.length, 0);
});

// 6 ----------------------------------------------------------------------------------------------
test("pending stays pending", async () => {
  const pendingCallback = harness();
  assert.equal((await handleOpayCallback(callback({ status: "PENDING" }), pendingCallback.deps)).status, 200);
  assert.equal(pendingCallback.calls.queries, 0, "a pending callback carries no final state");
  assert.equal(pendingCallback.calls.fails.length + pendingCallback.calls.completes.length + pendingCallback.calls.reviews.length, 0);

  for (const status of ["PENDING", "INITIAL"]) {
    const poll = harness({ provider: providerRecord({ status, transactionId: undefined }) });
    assert.deepEqual(await checkOpayPaymentStatus(ATTEMPT, poll.deps), { status: 200, body: { status: "PENDING" } });
    assert.equal(poll.calls.fails.length + poll.calls.completes.length + poll.calls.reviews.length, 0, status);
  }
});

// 7 ----------------------------------------------------------------------------------------------
test("duplicate and concurrent callbacks plus a status poll create exactly one order", async () => {
  // Stand-in for completeVerifiedPayment's idempotency (serializable claim + unique orderId):
  // the first verified completion creates the order, repeats return it as already processed.
  const orders = new Map<string, string>();
  let created = 0;
  const { deps, calls } = harness({
    complete: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const existing = orders.get(input.transactionReference);
      if (existing) return { orderId: existing, alreadyProcessed: true };
      created++;
      orders.set(input.transactionReference, "order-1");
      return { orderId: "order-1", alreadyProcessed: false };
    },
  });
  const responses = await Promise.all([handleOpayCallback(callback(), deps), handleOpayCallback(callback(), deps), handleOpayCallback(callback(), deps)]);
  const poll = await checkOpayPaymentStatus(ATTEMPT, deps);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
  assert.deepEqual(poll.body, { status: "SUCCESS", orderId: "order-1", printJobId: null });
  assert.equal(created, 1);
  assert.equal(new Set(calls.completes.map((input) => JSON.stringify(input))).size, 1, "every attempt finalizes the identical verified transaction");
  assert.equal(calls.reviews.length, 0);
});

test("duplicate CLOSE callbacks fail the attempt once and never flag it", async () => {
  const { deps, calls } = harness({ provider: providerRecord({ status: "CLOSE", transactionId: undefined }) });
  for (let i = 0; i < 3; i++) assert.equal((await handleOpayCallback(callback({ status: "CLOSE" }), deps)).status, 200);
  assert.equal(calls.fails.length, 3);
  assert.equal(calls.reviews.length, 0);
});

// 8 ----------------------------------------------------------------------------------------------
test("a successful payment cannot bypass transaction-ID validation", async () => {
  // Success with no provider transaction at all.
  const none = harness({ attempt: { ...ATTEMPT, providerCheckoutReference: null }, provider: providerRecord({ transactionId: undefined, orderNo: undefined }) });
  assert.equal((await handleOpayCallback(callback(), none.deps)).status, 200);
  assert.equal(none.calls.completes.length, 0);
  assert.equal(none.calls.reviews.length, 1);

  // Success whose queried transaction differs from the signed callback's transaction.
  const different = harness({ provider: providerRecord({ transactionId: "opay-txn-OTHER" }) });
  assert.equal((await handleOpayCallback(callback(), different.deps)).status, 200);
  assert.equal(different.calls.completes.length, 0);
  assert.deepEqual(different.calls.reviews, [{ reference: ATTEMPT.reference, reason: "provider verification mismatch" }]);

  // Success where OPay omits transactionId: the order number stands in and must still match the callback.
  const fallback = harness({ provider: providerRecord({ transactionId: undefined }) });
  await handleOpayCallback(callback({ transactionId: "opay-txn-1" }), fallback.deps);
  assert.equal(fallback.calls.completes.length, 0);
  assert.equal(fallback.calls.reviews.length, 1);
});

// 9 ----------------------------------------------------------------------------------------------
test("marketplace and print payments keep separate roots chosen by the lifecycle, not the handler", async () => {
  const marketplace = harness({ complete: async () => ({ orderId: "order-9", alreadyProcessed: false }) });
  assert.deepEqual((await checkOpayPaymentStatus(ATTEMPT, marketplace.deps)).body, { status: "SUCCESS", orderId: "order-9", printJobId: null });

  const print = harness({ complete: async () => ({ orderId: null, printJobId: "print-job-9", alreadyProcessed: false }) });
  assert.deepEqual((await checkOpayPaymentStatus(ATTEMPT, print.deps)).body, { status: "SUCCESS", orderId: null, printJobId: "print-job-9" });

  // The handler passes only the verified transaction; it never picks an order or print-job root itself.
  assert.deepEqual(Object.keys(print.calls.completes[0]).sort(), ["amount", "currency", "providerReference", "transactionReference"]);
});

test("a print payment the print lifecycle already moved to review is not double-flagged", async () => {
  const reviewError = Object.assign(new Error("This print job already has a confirmed payment."), { name: "PrintPaymentNeedsReviewError" });
  const webhook = harness({ complete: async () => { throw reviewError; } });
  assert.equal((await handleOpayCallback(callback(), webhook.deps)).status, 200);
  assert.equal(webhook.calls.reviews.length, 0);
  const poll = harness({ complete: async () => { throw reviewError; } });
  assert.equal((await checkOpayPaymentStatus(ATTEMPT, poll.deps)).status, 503, "the student is not told the payment is confirmed");
  assert.equal(poll.calls.reviews.length, 0);
});

// Callback gatekeeping and logging ---------------------------------------------------------------
test("invalid, refunded, foreign or unsigned callbacks are rejected before any lookup", async () => {
  const { deps, calls } = harness({ signature: () => false });
  assert.equal((await handleOpayCallback(callback(), deps)).status, 400);
  assert.equal((await handleOpayCallback({ nope: true }, deps)).status, 400);
  assert.equal((await handleOpayCallback(callback({ refunded: true }), harness().deps)).status, 400);
  assert.equal((await handleOpayCallback({ ...callback(), type: "other" }, harness().deps)).status, 400);
  assert.equal(calls.lookups, 0);
});

test("a verified callback for an unknown reference is acknowledged without querying or flagging", async () => {
  const { deps, calls } = harness({ attempt: null });
  assert.equal((await handleOpayCallback(callback(), deps)).status, 200);
  assert.equal(calls.queries + calls.reviews.length + calls.fails.length, 0);
});

test("logs carry status, amount and a reference tail, but never the signature, token or full reference", async () => {
  const { deps, logs } = harness({ provider: providerRecord({ status: "CLOSE", transactionId: undefined }) });
  await handleOpayCallback(callback({ status: "CLOSE" }), deps);
  const serialized = JSON.stringify(logs);
  assert.ok(!serialized.includes(SECRET_SIGNATURE));
  assert.ok(!serialized.includes(SECRET_TOKEN));
  assert.ok(!serialized.includes(ATTEMPT.reference));
  const received = logs.find((entry) => entry.event === "opay_callback_received");
  assert.deepEqual(
    { status: received?.fields.callbackStatus, amount: received?.fields.callbackAmount, refTail: received?.fields.refTail },
    { status: "CLOSE", amount: "130000", refTail: ATTEMPT.reference.slice(-8) },
  );
});
