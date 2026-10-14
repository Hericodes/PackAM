import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isOrphanedSuccessfulMarketplacePayment,
  isPaymentReconciliationIssue,
} from "./orphaned-marketplace-payment";

test("successful print payments are not orphaned marketplace payments", () => {
  assert.equal(isOrphanedSuccessfulMarketplacePayment({
    status: "SUCCESS",
    orderId: null,
    printJobId: "print-job-1",
  }), false);
  assert.equal(isPaymentReconciliationIssue({
    status: "SUCCESS",
    orderId: null,
    printJobId: "print-job-1",
  }), false);
});

test("a successful payment with neither order nor print job is an orphaned marketplace payment", () => {
  assert.equal(isOrphanedSuccessfulMarketplacePayment({
    status: "SUCCESS",
    orderId: null,
    printJobId: null,
  }), true);
  assert.equal(isPaymentReconciliationIssue({
    status: "RECONCILIATION_REQUIRED",
    orderId: "order-1",
    printJobId: null,
  }), true);
});
