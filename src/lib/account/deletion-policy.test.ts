import assert from "node:assert/strict";
import { test } from "node:test";
import { OrderStatus, PrintJobStatus } from "@prisma/client";
import { canTransitionOrder } from "../orders/state-machine";
import { canTransitionPrintJob } from "../printing/status-machine";
import {
  DELETE_CONFIRMATION,
  DELETION_BLOCKER_KINDS,
  INCIDENT_OPEN_STATUSES,
  ORDER_REFUNDABLE_STATUSES,
  ORDER_SETTLED_STATUSES,
  PAYMENT_CAPTURED_STATUSES,
  PAYMENT_OPEN_STATUSES,
  PRINT_JOB_ACTIVE_STATUSES,
  PRINT_JOB_CANCEL_BLOCKING_PAYMENT_STATUSES,
  PRINT_JOB_FINISHED_STATUSES,
  PRINT_JOB_REFUNDABLE_STATUSES,
  PRINT_JOB_UNPAID_STATUSES,
  PRODUCT_REQUEST_CANCELLABLE_STATUSES,
  REFUND_UNSETTLED_STATUSES,
  SUPPORT_CASE_OPEN_STATUSES,
  deletedAccountEmail,
  deletionBlockerMessage,
  deletionBlockers,
  isDeleteConfirmation,
} from "./deletion-policy";

test("the blocking statuses are exactly the agreed lists", () => {
  assert.deepEqual([...ORDER_SETTLED_STATUSES], ["DELIVERED", "REFUNDED", "CANCELLED", "FAILED"]);
  assert.deepEqual([...ORDER_REFUNDABLE_STATUSES], ["CANCELLED", "FAILED"]);
  assert.deepEqual([...PAYMENT_CAPTURED_STATUSES], ["SUCCESS", "RECONCILIATION_REQUIRED"]);
  assert.deepEqual([...PRINT_JOB_ACTIVE_STATUSES], [
    "PAYMENT_CONFIRMED", "FINDING_RUNNER", "RUNNER_ASSIGNED", "DOCUMENT_RECEIVED", "PRINTING", "PRINTED", "OUT_FOR_DELIVERY",
    "DOCUMENT_UNREADABLE", "PRINT_FAILED", "REFUND_PROCESSING",
  ]);
  assert.deepEqual([...PRINT_JOB_REFUNDABLE_STATUSES], ["CANCELLED", "FAILED"]);
  assert.deepEqual([...PAYMENT_OPEN_STATUSES], ["PENDING", "RECONCILIATION_REQUIRED"]);
  assert.deepEqual([...REFUND_UNSETTLED_STATUSES], ["PENDING", "PROCESSING", "FAILED"]);
  assert.deepEqual([...SUPPORT_CASE_OPEN_STATUSES], ["OPEN", "IN_PROGRESS", "ESCALATED"]);
  assert.deepEqual([...INCIDENT_OPEN_STATUSES], ["OPEN", "INVESTIGATING"]);
  assert.deepEqual([...PRODUCT_REQUEST_CANCELLABLE_STATUSES], ["PENDING", "CHECKING"]);
  assert.deepEqual([...PRINT_JOB_UNPAID_STATUSES], ["DRAFT", "READY_FOR_PAYMENT"]);
  assert.deepEqual([...PRINT_JOB_CANCEL_BLOCKING_PAYMENT_STATUSES], ["PENDING", "RECONCILIATION_REQUIRED", "SUCCESS", "REFUNDED"]);
  assert.deepEqual([...PRINT_JOB_FINISHED_STATUSES], ["DELIVERED", "REFUNDED", "CANCELLED", "FAILED"]);
});

test("the lists match the status machines: a settled order or finished print job can only move again into a refund", () => {
  const orderStatuses = Object.values(OrderStatus);
  for (const from of ORDER_SETTLED_STATUSES) {
    for (const to of orderStatuses) if (canTransitionOrder(from, to)) assert.equal(to, "REFUND_PROCESSING", `${from} → ${to}`);
  }
  assert.deepEqual(ORDER_SETTLED_STATUSES.filter((status) => canTransitionOrder(status, "REFUND_PROCESSING")), [...ORDER_REFUNDABLE_STATUSES]);

  const printStatuses = Object.values(PrintJobStatus);
  for (const from of PRINT_JOB_FINISHED_STATUSES) {
    for (const to of printStatuses) if (canTransitionPrintJob(from, to)) assert.equal(to, "REFUND_PROCESSING", `${from} → ${to}`);
  }
  assert.deepEqual(PRINT_JOB_FINISHED_STATUSES.filter((status) => canTransitionPrintJob(status, "REFUND_PROCESSING")), [...PRINT_JOB_REFUNDABLE_STATUSES]);
  // Every print status is exactly one of: never paid, in progress, finished.
  const groups: readonly string[][] = [[...PRINT_JOB_UNPAID_STATUSES], [...PRINT_JOB_ACTIVE_STATUSES], [...PRINT_JOB_FINISHED_STATUSES]];
  for (const status of printStatuses) assert.equal(groups.filter((group) => group.includes(status)).length, 1, status);
  // An unpaid job can always be cancelled by the status machine.
  for (const status of PRINT_JOB_UNPAID_STATUSES) assert.equal(canTransitionPrintJob(status, "CANCELLED"), true, status);
});

test("each blocker says what to do, in one sentence per count, with curly apostrophes only", () => {
  assert.equal(DELETION_BLOCKER_KINDS.length, 10);
  for (const kind of DELETION_BLOCKER_KINDS) {
    const one = deletionBlockerMessage(kind, 1);
    const three = deletionBlockerMessage(kind, 3);
    assert.equal(deletionBlockerMessage(kind), one, `${kind}: one by default`);
    assert.notEqual(one, three, kind);
    assert.doesNotMatch(one, /\d/, `${kind}: no count for a single record`);
    assert.match(three, /\b3\b/, `${kind}: the count is shown`);
    for (const message of [one, three]) {
      assert.match(message, /support|once/i, `${kind}: says what to do`);
      assert.doesNotMatch(message, /'/, `${kind}: curly apostrophes`);
      assert.match(message, /^[A-Z0-9].*\.$/, `${kind}: a sentence`);
    }
  }
  assert.equal(new Set(DELETION_BLOCKER_KINDS.map((kind) => deletionBlockerMessage(kind))).size, DELETION_BLOCKER_KINDS.length, "every message is different");
});

test("blockers come out in a fixed order with their counts; zero, negative and non-integer counts are left out", () => {
  assert.deepEqual(deletionBlockers({}), []);
  assert.deepEqual(deletionBlockers({ ORDER_IN_PROGRESS: 0, SUPPORT_CASE_OPEN: -1, INCIDENT_OPEN: Number.NaN, REFUND_UNSETTLED: 1.5 }), []);
  const blockers = deletionBlockers({ SUPPORT_CASE_OPEN: 2, ORDER_IN_PROGRESS: 1, PAYMENT_PENDING: 1 });
  assert.deepEqual(blockers.map((blocker) => [blocker.kind, blocker.count]), [["ORDER_IN_PROGRESS", 1], ["PAYMENT_PENDING", 1], ["SUPPORT_CASE_OPEN", 2]]);
  assert.equal(blockers[0].message, deletionBlockerMessage("ORDER_IN_PROGRESS", 1));
  assert.equal(blockers[2].message, deletionBlockerMessage("SUPPORT_CASE_OPEN", 2));
  assert.match(blockers[2].message, /^You have 2 open support requests\./);
});

test("a deleted account gets a unique address that can never receive mail", () => {
  assert.equal(deletedAccountEmail("cm123abc"), "deleted-cm123abc@deleted.packam.invalid");
  assert.notEqual(deletedAccountEmail("a"), deletedAccountEmail("b"));
  assert.match(deletedAccountEmail("cm123abc"), /\.invalid$/);
});

test("the typed confirmation forgives spaces and letter case, nothing else", () => {
  assert.equal(DELETE_CONFIRMATION, "DELETE");
  for (const ok of ["DELETE", " DELETE ", "delete", "Delete"]) assert.equal(isDeleteConfirmation(ok), true, ok);
  for (const bad of ["", "DELET", "DELETE ME", "yes", undefined, null, 1, ["DELETE"]]) assert.equal(isDeleteConfirmation(bad), false, String(bad));
});
