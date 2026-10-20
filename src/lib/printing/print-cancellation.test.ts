import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cancelUnpaidPrintJob,
  printCancellationResponse,
  printPaymentActions,
  type PrintCancellationDeps,
  type PrintCancelWriteResult,
  type PrintPaymentStatus,
} from "./print-cancellation";
import { canTransitionPrintJob } from "./status-machine";
import { canOfferFindingPrintJob } from "../orders/runner-offer-policy";
import { checkOpayPaymentStatus, handleOpayCallback, type CallbackDeps, type VerificationDeps } from "../payments/opay-verification";
import type { OpayTransaction } from "../payments/providers/opay-money";

const OWNER = "student-1";
const REFERENCE = "packam_print-cancel-0001";
const ATTEMPT = { reference: REFERENCE, amount: 1200, currency: "NGN", providerCheckoutReference: "opay-order-1" };

function providerRecord(status: string): OpayTransaction {
  return { reference: REFERENCE, orderNo: "opay-order-1", transactionId: "opay-txn-1", status, amount: { total: 120_000, currency: "NGN" } };
}

function callback(status = "SUCCESS") {
  return {
    type: "transaction-status",
    sha512: "a".repeat(128),
    payload: { amount: "120000", currency: "NGN", reference: REFERENCE, country: "NG", refunded: false, status, timestamp: "2026-10-20T10:00:00Z", transactionId: "opay-txn-1" },
  };
}

/**
 * In-memory print job and its OPay attempts, mirroring the real lifecycle: fail moves only PENDING →
 * FAILED; a verified success finalises an unpaid job once (READY_FOR_PAYMENT → FINDING_RUNNER) but is
 * recorded for review, never fulfilled, once the job is cancelled; cancelling happens once.
 */
function world(initial: { job?: string; payments?: PrintPaymentStatus[] }, provider: OpayTransaction | (() => OpayTransaction) = providerRecord("PENDING")) {
  const job = { status: initial.job ?? "READY_FOR_PAYMENT" };
  const payments: PrintPaymentStatus[] = [...(initial.payments ?? ["PENDING"])];
  const counts = { queries: 0, fulfilments: 0, reviews: 0, cancellations: 0 };
  const latest = () => payments.length - 1;

  const verification: VerificationDeps = {
    queryStatus: async () => { counts.queries++; return typeof provider === "function" ? provider() : provider; },
    complete: async () => {
      if (payments[latest()] === "SUCCESS") return { orderId: null, printJobId: "job-1", alreadyProcessed: true };
      if (job.status !== "READY_FOR_PAYMENT") {
        // recordDuplicatePrintPayment: kept for operations, never fulfilled.
        counts.reviews++;
        payments[latest()] = "RECONCILIATION_REQUIRED";
        throw Object.assign(new Error("needs review"), { name: "PrintPaymentNeedsReviewError" });
      }
      payments[latest()] = "SUCCESS";
      job.status = "FINDING_RUNNER";
      counts.fulfilments++;
      return { orderId: null, printJobId: "job-1", alreadyProcessed: false };
    },
    fail: async () => { if (payments[latest()] !== "PENDING") return false; payments[latest()] = "FAILED"; return true; },
    markReview: async () => { payments[latest()] = "RECONCILIATION_REQUIRED"; return true; },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  function depsFor(actor: { id: string; role: "STUDENT" | "ADMIN" }): PrintCancellationDeps {
    const allowed = () => actor.role === "ADMIN" || actor.id === OWNER;
    return {
      findJob: async () => allowed() ? { jobStatus: job.status, payments: [...payments] } : null,
      reconcilePending: async () => { if (allowed() && payments.includes("PENDING")) await checkOpayPaymentStatus(ATTEMPT, verification); },
      cancel: async (): Promise<PrintCancelWriteResult> => {
        if (!allowed()) return "NOT_CANCELLABLE";
        if (job.status === "CANCELLED") return "ALREADY_CANCELLED";
        if (!["DRAFT", "READY_FOR_PAYMENT"].includes(job.status) || payments.some((p) => p !== "FAILED")) return "NOT_CANCELLABLE";
        job.status = "CANCELLED";
        counts.cancellations++;
        return "CANCELLED";
      },
    };
  }
  const callbackDeps: CallbackDeps = { ...verification, verifySignature: () => true, findAttempt: async () => ATTEMPT };
  return { job, payments, counts, depsFor, verification, callbackDeps };
}

const student = { id: OWNER, role: "STUDENT" as const };

// ------------------------------------------------------------------ actions offered

test("a failed print payment offers Try Again and Cancel Print Job", () => {
  assert.deepEqual(printPaymentActions({ jobStatus: "READY_FOR_PAYMENT", payments: ["FAILED"] }), { canRetry: true, canCancel: true });
});

test("a pending print payment offers only Cancel Print Job", () => {
  assert.deepEqual(printPaymentActions({ jobStatus: "READY_FOR_PAYMENT", payments: ["FAILED", "PENDING"] }), { canRetry: false, canCancel: true });
});

test("paid, under-review and cancelled print jobs offer no unpaid-job actions", () => {
  const views: Array<{ jobStatus: string; payments: PrintPaymentStatus[] }> = [
    { jobStatus: "FINDING_RUNNER", payments: ["SUCCESS"] },
    { jobStatus: "READY_FOR_PAYMENT", payments: ["RECONCILIATION_REQUIRED"] },
    { jobStatus: "CANCELLED", payments: ["FAILED"] },
  ];
  for (const view of views) assert.deepEqual(printPaymentActions(view), { canRetry: false, canCancel: false }, view.jobStatus);
});

// ------------------------------------------------------------------ failed payments

test("confirmed failure then Cancel Print Job cancels the job once without querying OPay", async () => {
  const w = world({ payments: ["FAILED"] });
  const result = await cancelUnpaidPrintJob(w.depsFor(student));
  assert.deepEqual(result, { kind: "CANCELLED", alreadyCancelled: false });
  assert.equal(w.job.status, "CANCELLED");
  assert.equal(w.counts.queries, 0);
  assert.equal(printCancellationResponse(result).status, 200);
});

test("confirmed failure then Try Again: the same job is paid and fulfilled exactly once", async () => {
  const w = world({ payments: ["FAILED"] }, providerRecord("SUCCESS"));
  assert.equal(printPaymentActions({ jobStatus: w.job.status, payments: [...w.payments] }).canRetry, true);
  // Retrying adds a new attempt to the same job (never a new job); duplicate confirmations stay idempotent.
  w.payments.push("PENDING");
  await checkOpayPaymentStatus(ATTEMPT, w.verification);
  await handleOpayCallback(callback(), w.callbackDeps);
  assert.equal(w.job.status, "FINDING_RUNNER");
  assert.equal(w.counts.fulfilments, 1);
  assert.deepEqual(await cancelUnpaidPrintJob(w.depsFor(student)), { kind: "PAID" });
});

test("duplicate cancel requests cancel once and then report already cancelled", async () => {
  const w = world({ payments: ["FAILED"] });
  const deps = w.depsFor(student);
  const results = await Promise.all([cancelUnpaidPrintJob(deps), cancelUnpaidPrintJob(deps), cancelUnpaidPrintJob(deps)]);
  assert.ok(results.every((r) => r.kind === "CANCELLED"));
  assert.equal(results.filter((r) => r.kind === "CANCELLED" && !r.alreadyCancelled).length, 1);
  assert.equal(w.counts.cancellations, 1);
  assert.deepEqual(await cancelUnpaidPrintJob(deps), { kind: "CANCELLED", alreadyCancelled: true });
});

// ------------------------------------------------------------------ pending payments

test("pending payment still pending at OPay: not cancelled and not marked failed", async () => {
  const w = world({ payments: ["PENDING"] }, providerRecord("PENDING"));
  const result = await cancelUnpaidPrintJob(w.depsFor(student));
  assert.deepEqual(result, { kind: "STILL_PENDING" });
  assert.equal(w.counts.queries, 1, "reconciled with OPay before deciding");
  assert.deepEqual(w.payments, ["PENDING"]);
  assert.equal(w.job.status, "READY_FOR_PAYMENT");
  assert.match(String(printCancellationResponse(result).body.error), /still being confirmed/i);
});

test("pending payment that OPay verifies as closed is cancelled safely", async () => {
  const w = world({ payments: ["PENDING"] }, providerRecord("CLOSE"));
  assert.deepEqual(await cancelUnpaidPrintJob(w.depsFor(student)), { kind: "CANCELLED", alreadyCancelled: false });
  assert.deepEqual(w.payments, ["FAILED"]);
  assert.equal(w.job.status, "CANCELLED");
});

test("an OPay outage during a pending cancel changes nothing", async () => {
  const w = world({ payments: ["PENDING"] }, () => { throw new Error("network down"); });
  assert.deepEqual(await cancelUnpaidPrintJob(w.depsFor(student)), { kind: "STILL_PENDING" });
  assert.equal(w.job.status, "READY_FOR_PAYMENT");
  assert.deepEqual(w.payments, ["PENDING"]);
});

test("a payment under review blocks cancelling", async () => {
  const w = world({ payments: ["RECONCILIATION_REQUIRED"] });
  assert.deepEqual(await cancelUnpaidPrintJob(w.depsFor(student)), { kind: "UNDER_REVIEW" });
  assert.equal(w.job.status, "READY_FOR_PAYMENT");
});

// ------------------------------------------------------------------ successful and late payments

test("a successful payment prevents unpaid-job cancellation and promises no refund", async () => {
  const w = world({ job: "FINDING_RUNNER", payments: ["SUCCESS"] });
  const result = await cancelUnpaidPrintJob(w.depsFor(student));
  assert.deepEqual(result, { kind: "PAID" });
  assert.equal(w.job.status, "FINDING_RUNNER");
  const response = printCancellationResponse(result);
  assert.equal(response.status, 409);
  assert.doesNotMatch(JSON.stringify(response.body), /refund/i);
});

test("cancelling a pending payment that OPay reports as paid keeps the job and its fulfilment", async () => {
  const w = world({ payments: ["PENDING"] }, providerRecord("SUCCESS"));
  assert.deepEqual(await cancelUnpaidPrintJob(w.depsFor(student)), { kind: "PAID" });
  assert.equal(w.job.status, "FINDING_RUNNER");
  assert.equal(w.counts.fulfilments, 1);
  assert.equal(w.counts.cancellations, 0);
});

test("late success callbacks after cancellation are recorded for review and never fulfilled", async () => {
  const w = world({ payments: ["FAILED"] }, providerRecord("SUCCESS"));
  assert.equal((await cancelUnpaidPrintJob(w.depsFor(student))).kind, "CANCELLED");
  const first = await handleOpayCallback(callback(), w.callbackDeps);
  const duplicate = await handleOpayCallback(callback(), w.callbackDeps);
  assert.equal(first.status, 200, "under review is acknowledged so OPay stops retrying");
  assert.equal(duplicate.status, 200);
  assert.equal(w.job.status, "CANCELLED");
  assert.equal(w.counts.fulfilments, 0);
  assert.deepEqual(w.payments, ["RECONCILIATION_REQUIRED"]);
});

// ------------------------------------------------------------------ authorisation

test("another student cannot cancel, reconcile or even see the print job", async () => {
  const w = world({ payments: ["PENDING"] }, providerRecord("CLOSE"));
  const result = await cancelUnpaidPrintJob(w.depsFor({ id: "student-2", role: "STUDENT" }));
  assert.deepEqual(result, { kind: "NOT_FOUND" });
  assert.equal(printCancellationResponse(result).status, 404);
  assert.equal(w.counts.queries, 0);
  assert.equal(w.job.status, "READY_FOR_PAYMENT");
});

test("an administrator can cancel an unpaid print job under the same rules", async () => {
  const w = world({ payments: ["FAILED"] });
  assert.deepEqual(await cancelUnpaidPrintJob(w.depsFor({ id: "admin-1", role: "ADMIN" })), { kind: "CANCELLED", alreadyCancelled: false });
  const paid = world({ job: "FINDING_RUNNER", payments: ["SUCCESS"] });
  assert.deepEqual(await cancelUnpaidPrintJob(paid.depsFor({ id: "admin-1", role: "ADMIN" })), { kind: "PAID" });
});

// ------------------------------------------------------------------ fulfilment exclusion

test("a cancelled print job can never enter payment confirmation, runner offers or printing", () => {
  for (const next of ["PAYMENT_CONFIRMED", "FINDING_RUNNER", "RUNNER_ASSIGNED", "DOCUMENT_RECEIVED", "PRINTING", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    assert.equal(canTransitionPrintJob("CANCELLED", next), false, next);
  }
  assert.equal(canOfferFindingPrintJob({ status: "CANCELLED", assignedRunnerId: null }), false);
});
