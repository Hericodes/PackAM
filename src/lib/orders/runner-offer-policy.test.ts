import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMarketplaceMissionOffers,
  buildPrintMissionOffers,
  canOfferFindingOrder,
  canOfferFindingPrintJob,
  isEligibleAvailableRunner,
  planPrintMissionOffersAfterPayment,
  planPrintOffersWhenRunnerBecomesAvailable,
  printJobEnterFindingRunnerData,
  runnersWithoutExistingOffers,
  selectEligibleAvailableRunners,
  uniqueAssignmentsByPrintJobAndRunner,
} from "./runner-offer-policy";

const now = new Date("2026-10-06T16:00:00.000Z");
const eligibleRunner = {
  id: "runner-1",
  userId: "user-runner-1",
  isAvailable: true,
  isVerified: true,
  user: { role: "RUNNER", status: "ACTIVE" },
};

function paymentOfferInput(overrides: {
  runners?: typeof eligibleRunner[];
  existingAssignments?: Array<{ printJobId: string; runnerId: string }>;
  firstFinalization?: boolean;
} = {}) {
  return planPrintMissionOffersAfterPayment({
    job: { id: "print-job-1", status: "READY_FOR_PAYMENT", assignedRunnerId: null, orderId: null },
    payment: { orderId: null, printJobId: "print-job-1" },
    runners: overrides.runners ?? [eligibleRunner],
    existingAssignments: overrides.existingAssignments ?? [],
    now,
    firstFinalization: overrides.firstFinalization ?? true,
  });
}

test("print jobs receive findingRunnerAt when entering FINDING_RUNNER", () => {
  const first = paymentOfferInput({ firstFinalization: true });
  assert.deepEqual(printJobEnterFindingRunnerData(now), { findingRunnerAt: now });
  assert.equal(first.findingRunnerAt?.toISOString(), now.toISOString());
  assert.equal(paymentOfferInput({ firstFinalization: false }).findingRunnerAt, null);
});

test("eligible available runners receive print offers", () => {
  const result = paymentOfferInput();
  assert.equal(result.assignments.length, 1);
  assert.deepEqual(result.assignments[0], {
    orderId: null,
    printJobId: "print-job-1",
    runnerId: "runner-1",
    status: "OFFERED",
  });
  assert.equal(result.notifications[0]?.relatedType, "PRINT_JOB");
  assert.equal(result.notifications[0]?.relatedId, "print-job-1");
  assert.equal(result.notifications[0]?.orderId, null);
  assert.equal(result.notifications[0]?.idempotencyKey, "print-mission-offer:print-job-1:runner-1");
  assert.match(JSON.stringify(result.notifications), /print job/i);
  assert.doesNotMatch(JSON.stringify(result.notifications), /https?:\/\/|cloudinary|packam\/print-jobs|\.pdf/i);
});

test("unverified, inactive, and unavailable runners do not receive offers", () => {
  const runners = [
    eligibleRunner,
    { ...eligibleRunner, id: "unverified", userId: "u2", isVerified: false },
    { ...eligibleRunner, id: "inactive", userId: "u3", user: { role: "RUNNER", status: "SUSPENDED" } },
    { ...eligibleRunner, id: "offline", userId: "u4", isAvailable: false },
    { ...eligibleRunner, id: "student", userId: "u5", user: { role: "STUDENT", status: "ACTIVE" } },
  ];
  const eligible = selectEligibleAvailableRunners(runners);
  assert.deepEqual(eligible.map((runner) => runner.id), ["runner-1"]);
  assert.equal(isEligibleAvailableRunner(runners[1]!), false);
  assert.equal(isEligibleAvailableRunner(runners[2]!), false);
  assert.equal(isEligibleAvailableRunner(runners[3]!), false);
  const result = paymentOfferInput({ runners });
  assert.deepEqual(result.assignments.map((assignment) => assignment.runnerId), ["runner-1"]);
});

test("duplicate payment processing does not create duplicate print offers", () => {
  const first = paymentOfferInput();
  const second = paymentOfferInput({
    firstFinalization: false,
    existingAssignments: first.assignments.map((assignment) => ({
      printJobId: assignment.printJobId!,
      runnerId: assignment.runnerId,
    })),
  });
  assert.equal(first.assignments.length, 1);
  assert.equal(second.assignments.length, 0);
  const merged = uniqueAssignmentsByPrintJobAndRunner([...first.assignments, ...first.assignments]);
  assert.equal(merged.length, 1);
});

test("the same PrintJob and runner cannot receive duplicate active offers", () => {
  const offers = buildPrintMissionOffers("print-job-1", [eligibleRunner, eligibleRunner]);
  assert.equal(uniqueAssignmentsByPrintJobAndRunner(offers.assignments).length, 1);
  assert.deepEqual(
    runnersWithoutExistingOffers([eligibleRunner], ["runner-1"]),
    [],
  );
});

test("print jobs stay FINDING_RUNNER, unassigned, and without an Order after offers", () => {
  const result = paymentOfferInput();
  assert.equal(result.jobStatus, "FINDING_RUNNER");
  assert.equal(result.assignedRunnerId, null);
  assert.equal(result.createsOrder, false);
  assert.equal(result.printJobOrderId, null);
  assert.equal(result.paymentOrderId, null);
  assert.equal(canOfferFindingPrintJob({ status: "FINDING_RUNNER", assignedRunnerId: null }), true);
  assert.equal(canOfferFindingPrintJob({ status: "RUNNER_ASSIGNED", assignedRunnerId: "runner-1" }), false);
});

test("a newly available runner can receive eligible FINDING_RUNNER print jobs", () => {
  const offered = planPrintOffersWhenRunnerBecomesAvailable({
    runner: eligibleRunner,
    printJobs: [
      { id: "print-job-open", status: "FINDING_RUNNER", assignedRunnerId: null },
      { id: "print-job-assigned", status: "RUNNER_ASSIGNED", assignedRunnerId: "other" },
      { id: "print-job-existing", status: "FINDING_RUNNER", assignedRunnerId: null },
    ],
    existingAssignments: [{ printJobId: "print-job-existing", runnerId: "runner-1" }],
  });
  assert.equal(offered.length, 1);
  assert.equal(offered[0]?.assignments[0]?.printJobId, "print-job-open");
  assert.equal(offered[0]?.assignments[0]?.orderId, null);
  assert.equal(offered[0]?.notifications[0]?.relatedType, "PRINT_JOB");
});

test("marketplace runner offering still uses Order-backed assignments", () => {
  assert.equal(canOfferFindingOrder({ status: "FINDING_RUNNER", assignedRunnerId: null }), true);
  const offers = buildMarketplaceMissionOffers("order-1", [eligibleRunner]);
  assert.deepEqual(offers.assignments[0], { orderId: "order-1", runnerId: "runner-1", status: "OFFERED" });
  assert.equal("printJobId" in offers.assignments[0], false);
  assert.equal(offers.notifications[0]?.orderId, "order-1");
  assert.equal(offers.notifications[0]?.idempotencyKey, "mission-offer:order-1:runner-1");
  assert.notEqual(offers.notifications[0]?.idempotencyKey, "print-mission-offer:print-job-1:runner-1");
});
