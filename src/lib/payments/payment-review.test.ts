import assert from "node:assert/strict";
import { test } from "node:test";
import { handleOpayCallback, verifyOpayPaymentDetailed, type CallbackDeps, type CompletionResult, type VerificationDeps } from "./opay-verification";
import { OpayConfigurationError, OpayProviderRejectedError, OpayProviderUnavailableError } from "./payment-errors";
import type { OpayTransaction } from "./providers/opay-money";
import {
  CHECK_OUTCOME_DISPLAY,
  STALE_PENDING_AFTER_MS,
  describeCheck,
  formatUnresolvedFor,
  isUnresolvedPayment,
  reviewActions,
  validateReviewNote,
  type ReviewPaymentView,
} from "./payment-review-policy";

const ATTEMPT = { reference: "packam_review-0001", amount: 1300, currency: "NGN", providerCheckoutReference: "opay-order-1" };
const record = (status: string, overrides: Partial<OpayTransaction> = {}): OpayTransaction => ({ reference: ATTEMPT.reference, orderNo: "opay-order-1", transactionId: "opay-txn-1", status, amount: { total: 130_000, currency: "NGN" }, ...overrides });

function deps(query: () => Promise<OpayTransaction>, complete?: () => Promise<CompletionResult>) {
  const calls = { queries: 0, completes: 0, fails: 0, reviews: 0 };
  let paid = false;
  const verification: VerificationDeps = {
    queryStatus: async () => { calls.queries++; return query(); },
    // Mirrors completeVerifiedPayment: the first verified success finalises, repeats are idempotent.
    complete: complete ?? (async () => { calls.completes++; const already = paid; paid = true; return { orderId: "order-1", alreadyProcessed: already }; }),
    fail: async () => { calls.fails++; return true; },
    markReview: async () => { calls.reviews++; return true; },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { verification, calls };
}

// ------------------------------------------------------------------ provider unavailable

test("an OPay timeout or outage is reported as unavailable and changes nothing", async () => {
  for (const error of [new OpayProviderUnavailableError("OPay request timed out."), new OpayConfigurationError("missing"), new TypeError("fetch failed")]) {
    const { verification, calls } = deps(async () => { throw error; });
    const result = await verifyOpayPaymentDetailed(ATTEMPT, verification);
    assert.equal(result.outcome, "PROVIDER_UNAVAILABLE", error.name);
    assert.deepEqual({ completes: calls.completes, fails: calls.fails, reviews: calls.reviews }, { completes: 0, fails: 0, reviews: 0 }, "a timeout is never treated as a failure");
  }
});

test("a provider error code is recorded without being treated as a failed payment", async () => {
  const { verification, calls } = deps(async () => { throw new OpayProviderRejectedError("02001"); });
  const result = await verifyOpayPaymentDetailed(ATTEMPT, verification);
  assert.deepEqual(result, { outcome: "PROVIDER_UNAVAILABLE", errorName: "OpayProviderRejectedError", providerCode: "02001" });
  assert.equal(calls.fails, 0);
  assert.match(describeCheck(result), /provider code 02001/);
});

test("an invalid provider record is a mismatch and is flagged, never applied", async () => {
  const { verification, calls } = deps(async () => record("SUCCESS", { amount: { total: 1, currency: "NGN" } }));
  const result = await verifyOpayPaymentDetailed(ATTEMPT, verification);
  assert.equal(result.outcome, "MISMATCH");
  assert.equal(calls.completes, 0);
  assert.equal(calls.reviews, 1);
});

test("an answer PackAM can't apply (e.g. database error) is retryable, not a result", async () => {
  const { verification, calls } = deps(async () => record("SUCCESS"), async () => { throw new Error("db connection reset"); });
  const result = await verifyOpayPaymentDetailed(ATTEMPT, verification);
  assert.equal(result.outcome, "NOT_APPLIED");
  assert.equal(result.outcome === "NOT_APPLIED" && result.providerStatus, "SUCCESS");
  assert.equal(calls.reviews, 0);
});

// ------------------------------------------------------------------ provider-confirmed outcomes

test("provider-confirmed success finalises once across repeated verification attempts", async () => {
  const { verification, calls } = deps(async () => record("SUCCESS"));
  const first = await verifyOpayPaymentDetailed(ATTEMPT, verification);
  const second = await verifyOpayPaymentDetailed(ATTEMPT, verification);
  assert.equal(first.outcome, "CONFIRMED_SUCCESS");
  assert.equal(second.outcome, "CONFIRMED_SUCCESS");
  assert.equal(calls.queries, 2, "each retry is a fresh signed query");
  assert.equal(calls.completes, 2);
});

test("provider-confirmed failure and pending are reported as such", async () => {
  const failed = deps(async () => record("CLOSE"));
  assert.deepEqual(await verifyOpayPaymentDetailed(ATTEMPT, failed.verification), { outcome: "CONFIRMED_FAILED", providerStatus: "CLOSE" });
  assert.equal(failed.calls.fails, 1);
  const pending = deps(async () => record("INITIAL"));
  assert.deepEqual(await verifyOpayPaymentDetailed(ATTEMPT, pending.verification), { outcome: "PROVIDER_PENDING", providerStatus: "INITIAL" });
  assert.equal(pending.calls.fails, 0);
});

test("duplicate webhooks and a late admin check finalise the same payment once", async () => {
  let orders = 0;
  let paid = false;
  const { verification } = deps(async () => record("SUCCESS"), async () => { if (!paid) { paid = true; orders++; } return { orderId: "order-1", alreadyProcessed: orders > 0 && paid }; });
  const callbackDeps: CallbackDeps = { ...verification, verifySignature: () => true, findAttempt: async () => ATTEMPT };
  const body = { type: "transaction-status", sha512: "a".repeat(128), payload: { amount: "130000", currency: "NGN", reference: ATTEMPT.reference, country: "NG", refunded: false, status: "SUCCESS", timestamp: "2026-10-20T10:00:00Z", transactionId: "opay-txn-1" } };
  const [a, b] = await Promise.all([handleOpayCallback(body, callbackDeps), handleOpayCallback(body, callbackDeps)]);
  const late = await verifyOpayPaymentDetailed(ATTEMPT, verification);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(late.outcome, "CONFIRMED_SUCCESS");
  assert.equal(orders, 1);
});

// ------------------------------------------------------------------ review policy

const view = (overrides: Partial<ReviewPaymentView>): ReviewPaymentView => ({ paymentStatus: "RECONCILIATION_REQUIRED", orderId: null, printJobId: null, printJobStatus: null, hasTransactionReference: true, checkoutCancelled: false, caseStatus: null, ...overrides });

test("unresolved payments: under review, captured without an order, or pending past the checkout window", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);
  assert.equal(isUnresolvedPayment({ status: "RECONCILIATION_REQUIRED", orderId: null, printJobId: null, createdAt: at(1) }, now), true);
  assert.equal(isUnresolvedPayment({ status: "SUCCESS", orderId: null, printJobId: null, createdAt: at(1) }, now), true);
  assert.equal(isUnresolvedPayment({ status: "PENDING", orderId: null, printJobId: null, createdAt: at(STALE_PENDING_AFTER_MS / 60_000) }, now), true);
  assert.equal(isUnresolvedPayment({ status: "PENDING", orderId: null, printJobId: null, createdAt: at(10) }, now), false, "a fresh checkout is not stuck");
  assert.equal(isUnresolvedPayment({ status: "FAILED", orderId: null, printJobId: null, createdAt: at(999) }, now), false);
  assert.equal(isUnresolvedPayment({ status: "SUCCESS", orderId: "o", printJobId: null, createdAt: at(999) }, now), false);
});

test("actions offered match the money state; nothing unsafe is shown", () => {
  // Under review: verify, escalate, close — never cancel, because money may have been captured.
  assert.deepEqual(reviewActions(view({})), { verify: true, cancel: null, close: true, reopen: false, escalate: true });
  // Pending: verify, and cancel (the server reconciles first).
  assert.equal(reviewActions(view({ paymentStatus: "PENDING" })).cancel, "ORDER");
  assert.equal(reviewActions(view({ paymentStatus: "PENDING", printJobId: "j", printJobStatus: "READY_FOR_PAYMENT" })).cancel, "PRINT_JOB");
  // Confirmed failure: nothing to verify, cancel allowed until done.
  assert.deepEqual(reviewActions(view({ paymentStatus: "FAILED" })), { verify: false, cancel: "ORDER", close: true, reopen: false, escalate: true });
  assert.equal(reviewActions(view({ paymentStatus: "FAILED", checkoutCancelled: true })).cancel, null);
  assert.equal(reviewActions(view({ paymentStatus: "FAILED", printJobId: "j", printJobStatus: "CANCELLED" })).cancel, null);
  // Captured with no order, or linked to a paid order: no verify, no cancel.
  assert.deepEqual(reviewActions(view({ paymentStatus: "SUCCESS" })), { verify: false, cancel: null, close: true, reopen: false, escalate: true });
  assert.equal(reviewActions(view({ paymentStatus: "PENDING", orderId: "o" })).cancel, null);
  // No reference: OPay can't be asked.
  assert.equal(reviewActions(view({ hasTransactionReference: false })).verify, false);
  // Closed cases can only be reopened (and still verified).
  assert.deepEqual(reviewActions(view({ caseStatus: "CLOSED" })), { verify: true, cancel: null, close: false, reopen: true, escalate: false });
});

test("resolution notes are required and bounded", () => {
  assert.equal(validateReviewNote(undefined).ok, false);
  assert.equal(validateReviewNote("   ok   ").ok, false);
  assert.equal(validateReviewNote("x".repeat(1001)).ok, false);
  assert.deepEqual(validateReviewNote("  Called OPay support, ticket 123  "), { ok: true, note: "Called OPay support, ticket 123" });
});

test("every check outcome has wording, and non-confirmed outcomes never claim a result", () => {
  for (const [outcome, display] of Object.entries(CHECK_OUTCOME_DISPLAY)) {
    assert.ok(display.label && display.meaning, outcome);
    if (!outcome.startsWith("CONFIRMED")) assert.doesNotMatch(display.meaning, /\b(was paid|refunded|succeeded)\b/i, outcome);
  }
  assert.match(CHECK_OUTCOME_DISPLAY.PROVIDER_UNAVAILABLE.meaning, /proves nothing/);
  assert.equal(formatUnresolvedFor(new Date(0), new Date(3 * 24 * 3_600_000)), "3 days");
});
