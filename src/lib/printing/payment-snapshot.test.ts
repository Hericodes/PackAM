import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePrintCheckoutSnapshot,
  assertPrintJobMatchesCheckoutSnapshot,
  validatePrintPaymentFinalization,
} from "./payment-snapshot";

const snapshot = {
  kind: "PRINT_JOB",
  printJobId: "print-job-1",
  documentId: "document-1",
  documentPublicId: "packam/print-jobs/print-job-1.pdf",
  documentName: "lecture-notes.pdf",
  documentFileSize: 25_000,
  documentPageCount: 5,
  paperSize: "A4",
  colorMode: "BLACK_AND_WHITE",
  sides: "DOUBLE",
  copies: 2,
  pageSelection: "ALL",
  selectedPageCount: 5,
  instructions: null,
  pricePerPage: 100,
  pricingVersion: "2026-10-04",
  printSubtotal: 1_000,
  deliveryFee: 200,
  total: 1_200,
  currency: "NGN",
  deliveryLocationId: "location-1",
  deliveryLocationLabel: "Hostel",
  deliveryAddress: "Campus address",
  deliveryInstructions: null,
} as const;

test("validates the persisted server print snapshot without changing its amount", () => {
  const parsed = parsePrintCheckoutSnapshot(snapshot);
  assert.equal(parsed.total, 1_200);
  assert.equal(parsed.printSubtotal, 1_000);
  assert.equal(parsed.deliveryFee, 200);
  assert.equal(parsed.sides, "DOUBLE");
});

test("rejects amount, currency, page selection, copy, and delivery fee tampering", () => {
  for (const changed of [
    { total: 100 },
    { currency: "USD" },
    { printSubtotal: 100 },
    { pageSelection: "1-4" },
    { copies: 3 },
    { deliveryFee: 0 },
  ]) {
    assert.throws(() => parsePrintCheckoutSnapshot({ ...snapshot, ...changed }));
  }
});

test("server-owned legacy Phase 1 snapshots are enriched from the verified PrintDocument", () => {
  const phase1Snapshot: Record<string, unknown> = { ...snapshot };
  delete phase1Snapshot.documentId;
  delete phase1Snapshot.documentPublicId;
  delete phase1Snapshot.documentName;
  delete phase1Snapshot.documentFileSize;
  const job = {
    id: snapshot.printJobId,
    status: "READY_FOR_PAYMENT",
    paperSize: snapshot.paperSize,
    colorMode: snapshot.colorMode,
    sides: snapshot.sides,
    copies: snapshot.copies,
    pageSelection: snapshot.pageSelection,
    instructions: snapshot.instructions,
    pricePerPage: snapshot.pricePerPage,
    printSubtotal: snapshot.printSubtotal,
    deliveryFee: snapshot.deliveryFee,
    total: snapshot.total,
    pricingVersion: snapshot.pricingVersion,
    document: {
      id: snapshot.documentId,
      publicId: snapshot.documentPublicId,
      originalFileName: snapshot.documentName,
      fileSize: snapshot.documentFileSize,
      pageCount: snapshot.documentPageCount,
      mimeType: "application/pdf",
      storageProvider: "CLOUDINARY",
      deletedAt: null,
    },
  };
  const result = assertPrintJobMatchesCheckoutSnapshot(job, phase1Snapshot);
  assert.equal(result.documentPublicId, snapshot.documentPublicId);
  assert.equal(result.total, snapshot.total);
});

test("rejects persisted job settings that differ from the payment snapshot", () => {
  const job = {
    id: snapshot.printJobId,
    status: "READY_FOR_PAYMENT",
    paperSize: snapshot.paperSize,
    colorMode: snapshot.colorMode,
    sides: snapshot.sides,
    copies: snapshot.copies + 1,
    pageSelection: snapshot.pageSelection,
    instructions: snapshot.instructions,
    pricePerPage: snapshot.pricePerPage,
    printSubtotal: snapshot.printSubtotal,
    deliveryFee: snapshot.deliveryFee,
    total: snapshot.total,
    pricingVersion: snapshot.pricingVersion,
    document: {
      id: snapshot.documentId,
      publicId: snapshot.documentPublicId,
      originalFileName: snapshot.documentName,
      fileSize: snapshot.documentFileSize,
      pageCount: snapshot.documentPageCount,
      mimeType: "application/pdf",
      storageProvider: "CLOUDINARY",
      deletedAt: null,
    },
  };
  assert.throws(() => assertPrintJobMatchesCheckoutSnapshot(job, snapshot));
});

function finalizationFixture(overrides: {
  payment?: Record<string, unknown>;
  job?: Record<string, unknown>;
  verified?: Record<string, unknown>;
} = {}) {
  const job = {
    id: snapshot.printJobId,
    userId: "student-1",
    status: "READY_FOR_PAYMENT",
    paperSize: snapshot.paperSize,
    colorMode: snapshot.colorMode,
    sides: snapshot.sides,
    copies: snapshot.copies,
    pageSelection: snapshot.pageSelection,
    instructions: snapshot.instructions,
    pricePerPage: snapshot.pricePerPage,
    printSubtotal: snapshot.printSubtotal,
    deliveryFee: snapshot.deliveryFee,
    total: snapshot.total,
    pricingVersion: snapshot.pricingVersion,
    checkoutSnapshot: snapshot,
    document: {
      id: snapshot.documentId,
      publicId: snapshot.documentPublicId,
      originalFileName: snapshot.documentName,
      fileSize: snapshot.documentFileSize,
      pageCount: snapshot.documentPageCount,
      mimeType: "application/pdf",
      storageProvider: "CLOUDINARY",
      deletedAt: null,
    },
    ...overrides.job,
  };
  const payment = {
    userId: "student-1",
    printJobId: snapshot.printJobId,
    provider: "OPAY",
    status: "PENDING",
    amount: snapshot.total,
    currency: snapshot.currency,
    orderId: null,
    providerReference: null,
    checkoutSnapshot: snapshot,
    ...overrides.payment,
  };
  const verified = {
    provider: "OPAY",
    amount: snapshot.total,
    currency: snapshot.currency,
    providerReference: "opay-txn-1",
    ...overrides.verified,
  };
  return { payment, job, verified };
}

test("verified matching print payment can finalize only for its owned READY_FOR_PAYMENT job", () => {
  const result = validatePrintPaymentFinalization(finalizationFixture());
  assert.equal(result.alreadyProcessed, false);
  assert.equal(result.duplicate === false ? result.snapshot.total : null, 1_200);
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    payment: { userId: "another-student" },
  })), /linked to this print job/i);
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    job: { status: "DRAFT" },
  })), /settings do not match/i);
});

test("rejects mismatched payment amount, currency, provider and OPay transaction reference", () => {
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    payment: { amount: 100 },
  })), /amount or currency/i);
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    payment: { currency: "USD" },
  })), /amount or currency/i);
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    verified: { provider: "PAYSTACK" },
  })), /linked to this print job/i);
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    payment: { providerReference: "other-transaction" },
  })), /amount or currency/i);
});

test("a repeated verified callback is recognized as already finalized without re-transitioning", () => {
  const result = validatePrintPaymentFinalization(finalizationFixture({
    payment: { status: "SUCCESS", providerReference: "opay-txn-1" },
    job: { status: "FINDING_RUNNER" },
  }));
  assert.equal(result.alreadyProcessed, true);
  // A FAILED attempt that the provider now verifies is the job's only payment: finalise it once.
  const lateOnly = validatePrintPaymentFinalization(finalizationFixture({
    payment: { status: "FAILED" },
    job: { status: "READY_FOR_PAYMENT" },
  }));
  assert.equal(lateOnly.alreadyProcessed, false);
  assert.equal(lateOnly.duplicate, false);
  assert.equal("confirmedAfterFailure" in lateOnly && lateOnly.confirmedAfterFailure, true);
  // Refunded or otherwise closed attempts are still refused.
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    payment: { status: "REFUNDED" },
    job: { status: "READY_FOR_PAYMENT" },
  })), /no longer pending/i);
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    payment: { status: "SUCCESS", providerReference: "different-txn" },
    job: { status: "FINDING_RUNNER" },
  })), /transaction reference/i);
});

test("repeated verified callbacks stay idempotent after print fulfilment has progressed", () => {
  for (const status of ["FINDING_RUNNER", "RUNNER_ASSIGNED", "PRINTING", "OUT_FOR_DELIVERY", "DELIVERED", "REFUND_PROCESSING"]) {
    const result = validatePrintPaymentFinalization(finalizationFixture({
      payment: { status: "SUCCESS", providerReference: "opay-txn-1" },
      job: { status },
    }));
    assert.equal(result.alreadyProcessed, true, status);
  }
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    payment: { status: "SUCCESS", providerReference: "opay-txn-1" },
    job: { status: "READY_FOR_PAYMENT" },
  })), /unexpected print-job status/i);
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    payment: { status: "SUCCESS", providerReference: "opay-txn-1" },
    job: { status: "RUNNER_ASSIGNED" },
    verified: { providerReference: "opay-txn-other" },
  })), /different OPay transaction/i);
});

test("a verified success for an already-paid print job is a duplicate, never a second finalisation", () => {
  const cases = [
    { label: "job already past payment", payment: { status: "FAILED" }, job: { status: "FINDING_RUNNER" }, other: false },
    { label: "another payment already succeeded", payment: { status: "PENDING" }, job: { status: "READY_FOR_PAYMENT" }, other: true },
    { label: "attempt under review, job delivered", payment: { status: "RECONCILIATION_REQUIRED" }, job: { status: "DELIVERED" }, other: false },
  ];
  for (const { label, payment, job, other } of cases) {
    const result = validatePrintPaymentFinalization({ ...finalizationFixture({ payment, job }), otherSuccessfulPayment: other });
    assert.equal(result.alreadyProcessed, false, label);
    assert.equal(result.duplicate, true, label);
  }
  // Identity checks still run first: a mismatched amount is never recorded as a duplicate.
  assert.throws(() => validatePrintPaymentFinalization(finalizationFixture({
    payment: { status: "FAILED" }, job: { status: "FINDING_RUNNER" }, verified: { amount: 1 },
  })), /amount or currency/i);
});
