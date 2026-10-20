import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cancellationResponse,
  cancelUnpaidCheckout,
  checkoutPaymentActions,
  type CancelFailedResult,
  type CancellationDeps,
  type CheckoutPaymentStatus,
} from "./checkout-cancellation";
import { checkOpayPaymentStatus, handleOpayCallback, type CallbackDeps, type VerificationDeps } from "./opay-verification";
import type { OpayTransaction } from "./providers/opay-money";

const REFERENCE = "packam_cancel-test-0001";
const OWNER = "student-1";
const ATTEMPT = { reference: REFERENCE, amount: 1300, currency: "NGN", providerCheckoutReference: "opay-order-1" };

/**
 * In-memory stand-in for the payment row, mirroring the real lifecycle's guarantees:
 * fail only moves PENDING → FAILED, complete is idempotent for the same provider transaction and
 * refuses a FAILED attempt, and cancelling a FAILED attempt happens once.
 */
function world(initial: { status: CheckoutPaymentStatus; orderId?: string | null; cancelled?: boolean; newerAttempt?: boolean }, provider: OpayTransaction | (() => OpayTransaction) = providerRecord("PENDING")) {
  const row = { status: initial.status, orderId: initial.orderId ?? null, providerReference: null as string | null, cancelled: initial.cancelled ?? false };
  const counts = { orders: 0, cartReleases: 0, queries: 0, completes: 0, failedFinalisations: 0, reviews: 0 };

  const verification: VerificationDeps = {
    queryStatus: async () => { counts.queries++; return typeof provider === "function" ? provider() : provider; },
    complete: async (verified) => {
      counts.completes++;
      if (row.status === "SUCCESS") {
        assert.equal(row.providerReference, verified.providerReference);
        return { orderId: row.orderId, alreadyProcessed: true };
      }
      if (row.status !== "PENDING" && row.status !== "RECONCILIATION_REQUIRED") {
        counts.failedFinalisations++;
        throw new Error("Payment attempt is no longer pending.");
      }
      counts.orders++;
      Object.assign(row, { status: "SUCCESS", orderId: `order-${counts.orders}`, providerReference: verified.providerReference });
      return { orderId: row.orderId, alreadyProcessed: false };
    },
    fail: async () => { if (row.status !== "PENDING") return false; row.status = "FAILED"; return true; },
    markReview: async () => { counts.reviews++; row.status = "RECONCILIATION_REQUIRED"; return true; },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  function depsFor(userId: string): CancellationDeps {
    const owned = () => userId === OWNER;
    return {
      findAttempt: async () => owned() ? { status: row.status, orderId: row.orderId, cancelled: row.cancelled } : null,
      reconcile: async () => { if (owned() && row.status === "PENDING") await checkOpayPaymentStatus(ATTEMPT, verification); },
      cancelFailed: async (): Promise<CancelFailedResult> => {
        if (!owned() || row.status !== "FAILED" || row.orderId) return "NOT_FAILED";
        if (row.cancelled) return "ALREADY_CANCELLED";
        if (initial.newerAttempt) return "SUPERSEDED";
        row.cancelled = true;
        counts.cartReleases++;
        return "CANCELLED";
      },
    };
  }

  const callbackDeps: CallbackDeps = { ...verification, verifySignature: () => true, findAttempt: async () => ATTEMPT };
  return { row, counts, depsFor, verification, callbackDeps };
}

function providerRecord(status: string): OpayTransaction {
  return { reference: REFERENCE, orderNo: "opay-order-1", transactionId: "opay-txn-1", status, amount: { total: 130_000, currency: "NGN" } };
}

function callback(status = "SUCCESS") {
  return {
    type: "transaction-status",
    sha512: "a".repeat(128),
    payload: { amount: "130000", currency: "NGN", reference: REFERENCE, country: "NG", refunded: false, status, timestamp: "2026-10-20T10:00:00Z", transactionId: "opay-txn-1" },
  };
}

// ------------------------------------------------------------------ actions offered on the page

test("a failed payment offers Try Again and Cancel Order", () => {
  assert.deepEqual(checkoutPaymentActions({ status: "FAILED", orderId: null, cancelled: false }), { canRetry: true, canCancel: true });
});

test("a pending payment offers only Cancel Order, never a retry that could pay twice", () => {
  assert.deepEqual(checkoutPaymentActions({ status: "PENDING", orderId: null, cancelled: false }), { canRetry: false, canCancel: true });
});

test("successful, refunded, under-review and already-cancelled payments offer no unpaid-order actions", () => {
  for (const view of [
    { status: "SUCCESS", orderId: "order-1", cancelled: false },
    { status: "REFUNDED", orderId: "order-1", cancelled: false },
    { status: "RECONCILIATION_REQUIRED", orderId: null, cancelled: false },
    { status: "FAILED", orderId: null, cancelled: true },
  ] as const) {
    assert.deepEqual(checkoutPaymentActions(view), { canRetry: false, canCancel: false }, view.status);
  }
});

// ------------------------------------------------------------------ failed payments

test("cancelling a failed payment cancels it once and does not query OPay", async () => {
  const w = world({ status: "FAILED" });
  const result = await cancelUnpaidCheckout(w.depsFor(OWNER));
  assert.deepEqual(result, { kind: "CANCELLED", alreadyCancelled: false });
  assert.equal(w.counts.cartReleases, 1);
  assert.equal(w.counts.queries, 0, "an already-failed attempt needs no provider check");
  assert.equal(w.row.status, "FAILED", "the payment record itself is left as OPay reported it");
  assert.equal(cancellationResponse(result).status, 200);
});

test("repeated cancel clicks return the first result and release the cart once", async () => {
  const w = world({ status: "FAILED" });
  const deps = w.depsFor(OWNER);
  const results = await Promise.all([cancelUnpaidCheckout(deps), cancelUnpaidCheckout(deps), cancelUnpaidCheckout(deps)]);
  assert.equal(results.filter((r) => r.kind === "CANCELLED").length, 3);
  assert.equal(results.filter((r) => r.kind === "CANCELLED" && !r.alreadyCancelled).length, 1);
  assert.equal(w.counts.cartReleases, 1);
  const again = await cancelUnpaidCheckout(deps);
  assert.deepEqual(again, { kind: "CANCELLED", alreadyCancelled: true });
});

test("a failed attempt replaced by a newer checkout is not cancelled", async () => {
  const w = world({ status: "FAILED", newerAttempt: true });
  const result = await cancelUnpaidCheckout(w.depsFor(OWNER));
  assert.deepEqual(result, { kind: "SUPERSEDED" });
  assert.equal(w.counts.cartReleases, 0);
  assert.equal(cancellationResponse(result).status, 409);
});

// ------------------------------------------------------------------ pending / uncertain payments

test("a pending payment that OPay still reports as pending is not cancelled or failed", async () => {
  const w = world({ status: "PENDING" }, providerRecord("PENDING"));
  const result = await cancelUnpaidCheckout(w.depsFor(OWNER));
  assert.deepEqual(result, { kind: "STILL_PENDING" });
  assert.equal(w.counts.queries, 1, "reconciled with OPay before deciding");
  assert.equal(w.row.status, "PENDING", "uncertain payment is never marked failed to allow cancelling");
  assert.equal(w.counts.cartReleases, 0);
  const response = cancellationResponse(result);
  assert.equal(response.status, 409);
  assert.match(String(response.body.error), /still being confirmed/i);
});

test("a pending payment is cancelled only after OPay verifies it closed", async () => {
  for (const status of ["FAIL", "CLOSE"]) {
    const w = world({ status: "PENDING" }, providerRecord(status));
    const result = await cancelUnpaidCheckout(w.depsFor(OWNER));
    assert.deepEqual(result, { kind: "CANCELLED", alreadyCancelled: false }, status);
    assert.equal(w.row.status, "FAILED");
    assert.equal(w.counts.cartReleases, 1);
  }
});

test("an OPay outage while cancelling a pending payment changes nothing", async () => {
  const w = world({ status: "PENDING" }, () => { throw new Error("network down"); });
  const result = await cancelUnpaidCheckout(w.depsFor(OWNER));
  assert.deepEqual(result, { kind: "STILL_PENDING" });
  assert.equal(w.row.status, "PENDING");
  assert.equal(w.counts.reviews, 0, "a transient error is not flagged for review");
  assert.equal(w.counts.cartReleases, 0);
});

test("a payment under review cannot be cancelled and is not re-queried", async () => {
  const w = world({ status: "RECONCILIATION_REQUIRED" });
  const result = await cancelUnpaidCheckout(w.depsFor(OWNER));
  assert.deepEqual(result, { kind: "UNDER_REVIEW" });
  assert.equal(w.counts.queries, 0);
  assert.equal(w.counts.cartReleases, 0);
});

// ------------------------------------------------------------------ successful and late-successful payments

test("a successful payment has no unpaid-order cancellation path and promises no refund", async () => {
  const w = world({ status: "SUCCESS", orderId: "order-9" });
  const result = await cancelUnpaidCheckout(w.depsFor(OWNER));
  assert.deepEqual(result, { kind: "PAID", orderId: "order-9" });
  assert.equal(w.counts.cartReleases, 0);
  const response = cancellationResponse(result);
  assert.equal(response.status, 409);
  assert.equal(response.body.status, "SUCCESS");
  assert.doesNotMatch(JSON.stringify(response.body), /refund/i);
});

test("cancelling a pending payment that OPay reports as paid creates the order instead of cancelling", async () => {
  const w = world({ status: "PENDING" }, providerRecord("SUCCESS"));
  const result = await cancelUnpaidCheckout(w.depsFor(OWNER));
  assert.deepEqual(result, { kind: "PAID", orderId: "order-1" });
  assert.equal(w.counts.orders, 1);
  assert.equal(w.counts.cartReleases, 0);
});

test("a success callback racing a cancel and a duplicate callback produces one order and no cancellation", async () => {
  const w = world({ status: "PENDING" }, providerRecord("SUCCESS"));
  const [first, cancel, duplicate] = await Promise.all([
    handleOpayCallback(callback(), w.callbackDeps),
    cancelUnpaidCheckout(w.depsFor(OWNER)),
    handleOpayCallback(callback(), w.callbackDeps),
  ]);
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(cancel.kind, "PAID");
  assert.equal(w.counts.orders, 1, "duplicate finalisation never creates a second order");
  assert.equal(w.counts.cartReleases, 0);
  assert.equal(w.row.cancelled, false);
});

test("a late success callback after cancellation never creates an order or un-cancels it", async () => {
  const w = world({ status: "FAILED" }, providerRecord("SUCCESS"));
  assert.equal((await cancelUnpaidCheckout(w.depsFor(OWNER))).kind, "CANCELLED");
  const late = await handleOpayCallback(callback(), w.callbackDeps);
  // The lifecycle refuses to finalise a FAILED attempt (and alerts operations); OPay will retry.
  assert.equal(late.status, 503);
  assert.equal(w.counts.failedFinalisations, 1);
  assert.equal(w.counts.orders, 0);
  assert.equal(w.row.status, "FAILED");
  assert.equal(w.row.cancelled, true);
  assert.deepEqual(await cancelUnpaidCheckout(w.depsFor(OWNER)), { kind: "CANCELLED", alreadyCancelled: true });
});

// ------------------------------------------------------------------ authorisation

test("another student's payment reference cannot be cancelled and looks like it does not exist", async () => {
  const w = world({ status: "FAILED" });
  const result = await cancelUnpaidCheckout(w.depsFor("student-2"));
  assert.deepEqual(result, { kind: "NOT_FOUND" });
  assert.equal(cancellationResponse(result).status, 404);
  assert.equal(w.counts.cartReleases, 0);
  assert.equal(w.row.cancelled, false);
});

test("another student cannot trigger reconciliation of a pending payment", async () => {
  const w = world({ status: "PENDING" }, providerRecord("SUCCESS"));
  assert.deepEqual(await cancelUnpaidCheckout(w.depsFor("student-2")), { kind: "NOT_FOUND" });
  assert.equal(w.counts.queries, 0);
  assert.equal(w.counts.orders, 0);
});
