import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decidePrintAcceptance,
  isPrintMissionIssueAction,
  isPrintMissionStepAction,
  planPrintMissionIssue,
  planPrintMissionStep,
  runnerMayAccessPrintDocument,
  sanitizeIssueNote,
  toRunnerPrintMissionView,
} from "./runner-mission-policy";

const now = new Date("2026-10-13T10:00:00.000Z");
const runner = { id: "runner-1", isAvailable: true };
const openJob = { status: "FINDING_RUNNER", assignedRunnerId: null, findingRunnerAt: new Date(now.getTime() - 5 * 60_000) };

function accept(overrides: Partial<Parameters<typeof decidePrintAcceptance>[0]> = {}) {
  return decidePrintAcceptance({ runner, assignment: { status: "OFFERED", offeredAt: new Date(now.getTime() - 5 * 60_000) }, job: openJob, now, timeoutMinutes: 15, ...overrides });
}

test("a valid print offer can be accepted", () => {
  assert.deepEqual(accept(), { kind: "accept" });
});

test("repeated acceptance by the winning runner is idempotent", () => {
  assert.deepEqual(accept({
    assignment: { status: "ACCEPTED", offeredAt: now },
    job: { ...openJob, status: "RUNNER_ASSIGNED", assignedRunnerId: "runner-1" },
  }), { kind: "already-accepted" });
});

test("a losing runner gets a clear conflict once another runner holds the job", () => {
  const decision = accept({ job: { ...openJob, status: "RUNNER_ASSIGNED", assignedRunnerId: "runner-2" } });
  assert.equal(decision.kind, "rejected");
  assert.equal(decision.kind === "rejected" && decision.status, 409);
  assert.match(decision.kind === "rejected" ? decision.message : "", /already picked/i);
  // Even an assignment the acceptance flow expired cannot be revived.
  assert.equal(accept({ assignment: { status: "EXPIRED", offeredAt: now }, job: { ...openJob, status: "RUNNER_ASSIGNED", assignedRunnerId: "runner-2" } }).kind, "rejected");
});

test("runners without an offer for the job cannot accept it", () => {
  const decision = accept({ assignment: null });
  assert.equal(decision.kind === "rejected" && decision.status, 404);
  assert.equal(accept({ job: null }).kind, "rejected");
});

test("expired, cancelled and stale offers cannot be accepted", () => {
  for (const status of ["EXPIRED", "CANCELLED", "REJECTED"]) {
    assert.equal(accept({ assignment: { status, offeredAt: now } }).kind, "rejected", status);
  }
  // An offer expires by its own age…
  assert.match(
    (accept({ assignment: { status: "OFFERED", offeredAt: new Date(now.getTime() - 16 * 60_000) } }) as { message: string }).message,
    /expired/i,
  );
  // …not the job's: a fresh redispatched offer on a job that has waited two hours can be accepted.
  assert.deepEqual(accept({ job: { ...openJob, findingRunnerAt: new Date(now.getTime() - 120 * 60_000) }, assignment: { status: "OFFERED", offeredAt: new Date(now.getTime() - 1 * 60_000) } }), { kind: "accept" });
  assert.equal(accept({ job: { ...openJob, status: "REFUND_PROCESSING" } }).kind, "rejected");
});

test("an unavailable runner cannot accept", () => {
  assert.match((accept({ runner: { id: "runner-1", isAvailable: false } }) as { message: string }).message, /available/i);
});

test("print lifecycle steps follow the PrintJob status machine in order", () => {
  const path = [
    ["RUNNER_ASSIGNED", "document-received", "DOCUMENT_RECEIVED"],
    ["DOCUMENT_RECEIVED", "start-printing", "PRINTING"],
    ["PRINTING", "printed", "PRINTED"],
    ["PRINTED", "start-delivery", "OUT_FOR_DELIVERY"],
    ["OUT_FOR_DELIVERY", "delivered", "DELIVERED"],
  ] as const;
  for (const [from, action, to] of path) {
    const plan = planPrintMissionStep(from, action);
    assert.equal(plan.kind, "transition", action);
    assert.equal(plan.kind === "transition" && plan.to, to);
  }
});

test("invalid or skipped lifecycle steps are rejected", () => {
  assert.equal(planPrintMissionStep("RUNNER_ASSIGNED", "printed").kind, "rejected");
  assert.equal(planPrintMissionStep("FINDING_RUNNER", "document-received").kind, "rejected");
  assert.equal(planPrintMissionStep("PRINTING", "delivered").kind, "rejected");
  assert.equal(planPrintMissionStep("PRINT_FAILED", "start-printing").kind, "rejected");
  assert.equal(planPrintMissionStep("REFUND_PROCESSING", "delivered").kind, "rejected");
  assert.equal(planPrintMissionStep("DELIVERED", "start-delivery").kind, "rejected");
});

test("duplicate lifecycle requests are no-ops rather than new transitions", () => {
  assert.deepEqual(planPrintMissionStep("DOCUMENT_RECEIVED", "document-received"), { kind: "already-done", status: "DOCUMENT_RECEIVED" });
  assert.deepEqual(planPrintMissionStep("DELIVERED", "delivered"), { kind: "already-done", status: "DELIVERED" });
  assert.deepEqual(planPrintMissionIssue("PRINT_FAILED", "print-failed"), { kind: "already-done", status: "PRINT_FAILED" });
});

test("issue reports are allowed only while the document is being handled", () => {
  assert.equal(planPrintMissionIssue("RUNNER_ASSIGNED", "document-unreadable").kind, "transition");
  assert.equal(planPrintMissionIssue("PRINTING", "print-failed").kind, "transition");
  assert.equal(planPrintMissionIssue("RUNNER_ASSIGNED", "print-failed").kind, "rejected");
  assert.equal(planPrintMissionIssue("OUT_FOR_DELIVERY", "document-unreadable").kind, "rejected");
});

test("client-supplied actions are validated against a closed list", () => {
  assert.equal(isPrintMissionStepAction("delivered"), true);
  assert.equal(isPrintMissionStepAction("DELIVERED"), false);
  assert.equal(isPrintMissionStepAction("toString"), false);
  assert.equal(isPrintMissionStepAction({ action: "delivered" }), false);
  assert.equal(isPrintMissionIssueAction("print-failed"), true);
  assert.equal(isPrintMissionIssueAction("__proto__"), false);
});

const assignedJob = { status: "RUNNER_ASSIGNED" as const, assignedRunnerId: "runner-1" };
const liveDocument = { deletedAt: null };

test("the assigned runner can access only their accepted job's document", () => {
  assert.equal(runnerMayAccessPrintDocument({ runnerId: "runner-1", assignment: { runnerId: "runner-1", status: "ACCEPTED" }, job: assignedJob, document: liveDocument }), true);
  for (const status of ["DOCUMENT_RECEIVED", "PRINTING"] as const) {
    assert.equal(runnerMayAccessPrintDocument({ runnerId: "runner-1", assignment: { runnerId: "runner-1", status: "ACCEPTED" }, job: { ...assignedJob, status }, document: liveDocument }), true);
  }
});

test("offered, expired, cancelled and unrelated runners cannot access the document", () => {
  for (const status of ["OFFERED", "EXPIRED", "CANCELLED", "REJECTED", "COMPLETED"]) {
    assert.equal(runnerMayAccessPrintDocument({ runnerId: "runner-1", assignment: { runnerId: "runner-1", status }, job: assignedJob, document: liveDocument }), false, status);
  }
  // An unrelated runner, even with an accepted assignment record elsewhere.
  assert.equal(runnerMayAccessPrintDocument({ runnerId: "runner-2", assignment: { runnerId: "runner-1", status: "ACCEPTED" }, job: assignedJob, document: liveDocument }), false);
  assert.equal(runnerMayAccessPrintDocument({ runnerId: "runner-2", assignment: null, job: assignedJob, document: liveDocument }), false);
  // Assignment says accepted but the job is held by someone else.
  assert.equal(runnerMayAccessPrintDocument({ runnerId: "runner-1", assignment: { runnerId: "runner-1", status: "ACCEPTED" }, job: { ...assignedJob, assignedRunnerId: "runner-2" }, document: liveDocument }), false);
});

test("document access closes once printing is done or the job stopped", () => {
  for (const status of ["FINDING_RUNNER", "PRINTED", "OUT_FOR_DELIVERY", "DELIVERED", "REFUND_PROCESSING", "PRINT_FAILED"] as const) {
    assert.equal(runnerMayAccessPrintDocument({ runnerId: "runner-1", assignment: { runnerId: "runner-1", status: "ACCEPTED" }, job: { ...assignedJob, status }, document: liveDocument }), false, status);
  }
  assert.equal(runnerMayAccessPrintDocument({ runnerId: "runner-1", assignment: { runnerId: "runner-1", status: "ACCEPTED" }, job: assignedJob, document: { deletedAt: new Date() } }), false);
  assert.equal(runnerMayAccessPrintDocument({ runnerId: "runner-1", assignment: { runnerId: "runner-1", status: "ACCEPTED" }, job: assignedJob, document: null }), false);
});

const missionJob = {
  id: "8d1c2b9a-0000-4000-8000-1234abcd5678",
  status: "FINDING_RUNNER" as const,
  paperSize: "A4",
  colorMode: "BLACK_AND_WHITE",
  sides: "DOUBLE",
  copies: 2,
  pageSelection: "1-5",
  selectedPageCount: 5,
  instructions: "Staple please",
  checkoutSnapshot: {
    documentPublicId: "packam/print-jobs/8d1c2b9a.pdf",
    deliveryLocationLabel: "Hall 3",
    deliveryAddress: "Room 12, Hall 3",
    deliveryInstructions: "Call on arrival",
  },
  document: { originalFileName: "thesis.pdf", pageCount: 12, deletedAt: null },
  user: { firstName: "Ada", phone: "08000000000" },
};

test("offered runners see print settings but no document, address or student details", () => {
  const view = toRunnerPrintMissionView({ assignmentStatus: "OFFERED", job: missionJob });
  assert.equal(view.kind, "PRINT");
  assert.equal(view.selectedPageCount, 5);
  assert.equal(view.copies, 2);
  assert.equal(view.deliveryLocationLabel, "Hall 3");
  for (const key of ["documentName", "deliveryAddress", "deliveryInstructions", "student", "instructions", "documentAvailable"]) {
    assert.equal(key in view, false, key);
  }
});

test("assigned runners see delivery details, and no view ever carries storage identifiers or URLs", () => {
  const view = toRunnerPrintMissionView({ assignmentStatus: "ACCEPTED", job: { ...missionJob, status: "RUNNER_ASSIGNED" } });
  assert.equal(view.deliveryAddress, "Room 12, Hall 3");
  assert.equal(view.documentName, "thesis.pdf");
  assert.equal(view.documentAvailable, true);
  for (const assignmentStatus of ["OFFERED", "ACCEPTED"]) {
    const serialized = JSON.stringify(toRunnerPrintMissionView({ assignmentStatus, job: missionJob }));
    assert.doesNotMatch(serialized, /publicId|packam\/print-jobs|https?:\/\/|cloudinary/i);
  }
  const delivered = toRunnerPrintMissionView({ assignmentStatus: "COMPLETED", job: { ...missionJob, status: "DELIVERED" } });
  assert.equal(delivered.documentAvailable, false);
});

test("issue notes are bounded and stripped of control characters", () => {
  assert.equal(sanitizeIssueNote("  paper\u0000jam\n "), "paper jam");
  assert.equal(sanitizeIssueNote("x".repeat(900)).length, 500);
  assert.equal(sanitizeIssueNote(42), "");
});
