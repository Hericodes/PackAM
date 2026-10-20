import assert from "node:assert/strict";
import { test } from "node:test";
import { OrderStatus, PaymentStatus, PrintJobStatus } from "@prisma/client";
import { ORDER_STATUS_DISPLAY, PAYMENT_STATUS_DISPLAY, PRINT_STATUS_DISPLAY, paymentStatusDisplay, runnerOrderNextStep, runnerPrintNextStep } from "./ops-status";
import { orderListWhere, printJobListWhere } from "./admin-list-filters";

test("every order, print and payment status has an operations label", () => {
  for (const status of Object.values(OrderStatus)) assert.ok(ORDER_STATUS_DISPLAY[status], status);
  for (const status of Object.values(PrintJobStatus)) assert.ok(PRINT_STATUS_DISPLAY[status], status);
  for (const status of Object.values(PaymentStatus)) assert.ok(PAYMENT_STATUS_DISPLAY[status], status);
  assert.equal(paymentStatusDisplay(null).tone, "danger", "an order with no payment record is flagged");
  assert.equal(PAYMENT_STATUS_DISPLAY.RECONCILIATION_REQUIRED.tone, "danger");
});

test("runner next steps cover every active mission stage and describe offers as needing acceptance", () => {
  for (const status of ["RUNNER_ASSIGNED", "SOURCING_PRODUCT", "OUT_FOR_DELIVERY"]) assert.ok(runnerOrderNextStep(status, "ACCEPTED"), status);
  for (const status of ["RUNNER_ASSIGNED", "DOCUMENT_RECEIVED", "PRINTING", "PRINTED", "OUT_FOR_DELIVERY"]) assert.ok(runnerPrintNextStep(status, "ACCEPTED"), status);
  assert.match(runnerOrderNextStep("FINDING_RUNNER", "OFFERED") ?? "", /accept/i);
  assert.match(runnerPrintNextStep("FINDING_RUNNER", "OFFERED") ?? "", /accept/i);
  assert.equal(runnerOrderNextStep("DELIVERED", "ACCEPTED"), null);
});

test("admin print-job filters: paid jobs by default, groups and exact statuses, reference search", () => {
  assert.deepEqual(printJobListWhere(undefined, undefined).where, { status: { notIn: ["DRAFT", "READY_FOR_PAYMENT"] } });
  assert.deepEqual(printJobListWhere("ISSUES", "").where, { status: { in: ["DOCUMENT_UNREADABLE", "PRINT_FAILED"] } });
  assert.equal(printJobListWhere("NOT_A_STATUS", "").status, "", "unknown statuses fall back to paid jobs");
  const byReference = printJobListWhere("", "PR-1A2B3C4D").where as { OR: unknown[] };
  assert.deepEqual(byReference.OR[1], { id: { endsWith: "1a2b3c4d" } });
  const byEmail = printJobListWhere("", "ada@uni.test").where as { OR: unknown[] };
  assert.equal(byEmail.OR.length, 1, "an email is not treated as a reference");
});

test("admin order filters: in-progress group, exact statuses and student search", () => {
  const active = orderListWhere("ACTIVE", "").where as { status: { in: string[] } };
  assert.ok(active.status.in.includes("OUT_FOR_DELIVERY") && !active.status.in.includes("DELIVERED"));
  assert.deepEqual(orderListWhere("DELIVERED", "").where, { status: "DELIVERED" });
  assert.deepEqual(orderListWhere("bogus", "").where, {});
  const search = orderListWhere("", "Ada Obi").where as { OR: Array<Record<string, unknown>> };
  assert.ok(search.OR.some((clause) => "user" in clause && JSON.stringify(clause).includes("firstName")));
});
