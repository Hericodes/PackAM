import type { PrintJobStatus } from "@prisma/client";
import { canTransitionPrintJob } from "./status-machine";

/** Pure rules for print missions. The transactional service applies them under database guards. */

export const PRINT_MISSION_STEPS = {
  "document-received": { from: "RUNNER_ASSIGNED", to: "DOCUMENT_RECEIVED", note: "Assigned runner confirmed the document was received." },
  "start-printing": { from: "DOCUMENT_RECEIVED", to: "PRINTING", note: "Assigned runner started printing." },
  printed: { from: "PRINTING", to: "PRINTED", note: "Assigned runner finished printing." },
  "start-delivery": { from: "PRINTED", to: "OUT_FOR_DELIVERY", note: "Assigned runner started delivery." },
  delivered: { from: "OUT_FOR_DELIVERY", to: "DELIVERED", note: "Assigned runner completed the delivery." },
} as const satisfies Record<string, { from: PrintJobStatus; to: PrintJobStatus; note: string }>;

export type PrintMissionStepAction = keyof typeof PRINT_MISSION_STEPS;

export const PRINT_MISSION_ISSUES = {
  "document-unreadable": { to: "DOCUMENT_UNREADABLE", from: ["RUNNER_ASSIGNED", "DOCUMENT_RECEIVED", "PRINTING"] },
  "print-failed": { to: "PRINT_FAILED", from: ["DOCUMENT_RECEIVED", "PRINTING"] },
} as const satisfies Record<string, { to: PrintJobStatus; from: readonly PrintJobStatus[] }>;

export type PrintMissionIssueAction = keyof typeof PRINT_MISSION_ISSUES;

export function isPrintMissionStepAction(value: unknown): value is PrintMissionStepAction {
  return typeof value === "string" && Object.hasOwn(PRINT_MISSION_STEPS, value);
}

export function isPrintMissionIssueAction(value: unknown): value is PrintMissionIssueAction {
  return typeof value === "string" && Object.hasOwn(PRINT_MISSION_ISSUES, value);
}

type Rejected = { kind: "rejected"; message: string; status: 403 | 404 | 409 };

export type PrintAcceptanceDecision = { kind: "accept" } | { kind: "already-accepted" } | Rejected;

export function decidePrintAcceptance(input: {
  runner: { id: string; isAvailable: boolean };
  assignment: { status: string } | null;
  job: { status: string; assignedRunnerId: string | null; findingRunnerAt: Date | null } | null;
  now: Date;
  timeoutMinutes: number;
}): PrintAcceptanceDecision {
  const { runner, assignment, job } = input;
  // An unrelated runner learns nothing about whether the job exists.
  if (!assignment || !job) return { kind: "rejected", message: "This mission is no longer available.", status: 404 };
  if (assignment.status === "ACCEPTED" && job.assignedRunnerId === runner.id) return { kind: "already-accepted" };
  if (job.assignedRunnerId || job.status !== "FINDING_RUNNER") {
    return { kind: "rejected", message: "Someone already picked this mission 🫡", status: 409 };
  }
  if (assignment.status !== "OFFERED") return { kind: "rejected", message: "This mission is no longer available.", status: 409 };
  if (!runner.isAvailable) return { kind: "rejected", message: "Go available before accepting a mission.", status: 409 };
  if (job.findingRunnerAt && input.now.getTime() - job.findingRunnerAt.getTime() > input.timeoutMinutes * 60_000) {
    return { kind: "rejected", message: "This mission has expired.", status: 409 };
  }
  return { kind: "accept" };
}

export type PrintMissionPlan =
  | { kind: "transition"; from: PrintJobStatus; to: PrintJobStatus; note: string }
  | { kind: "already-done"; status: PrintJobStatus }
  | Rejected;

export function planPrintMissionStep(current: PrintJobStatus, action: PrintMissionStepAction): PrintMissionPlan {
  const step = PRINT_MISSION_STEPS[action];
  if (current === step.to) return { kind: "already-done", status: current };
  if (current !== step.from || !canTransitionPrintJob(current, step.to)) {
    return { kind: "rejected", message: `This print job is ${statusLabel(current)} and can’t do that now.`, status: 409 };
  }
  return { kind: "transition", from: current, to: step.to, note: step.note };
}

export function planPrintMissionIssue(current: PrintJobStatus, issue: PrintMissionIssueAction): PrintMissionPlan {
  const rule = PRINT_MISSION_ISSUES[issue];
  if (current === rule.to) return { kind: "already-done", status: current };
  if (!(rule.from as readonly PrintJobStatus[]).includes(current) || !canTransitionPrintJob(current, rule.to)) {
    return { kind: "rejected", message: `This print job is ${statusLabel(current)} and can’t take that report now.`, status: 409 };
  }
  return { kind: "transition", from: current, to: rule.to, note: issue === "document-unreadable" ? "Runner reported the document is unreadable." : "Runner reported a printing failure." };
}

/** Statuses in which the assigned runner genuinely needs the PDF. */
export const PRINT_DOCUMENT_ACCESS_STATUSES: readonly PrintJobStatus[] = ["RUNNER_ASSIGNED", "DOCUMENT_RECEIVED", "PRINTING"];

export function runnerMayAccessPrintDocument(input: {
  runnerId: string;
  assignment: { runnerId: string; status: string } | null;
  job: { status: PrintJobStatus; assignedRunnerId: string | null };
  document: { deletedAt: Date | null } | null;
}) {
  return Boolean(
    input.assignment &&
      input.assignment.runnerId === input.runnerId &&
      input.assignment.status === "ACCEPTED" &&
      input.job.assignedRunnerId === input.runnerId &&
      PRINT_DOCUMENT_ACCESS_STATUSES.includes(input.job.status) &&
      input.document &&
      !input.document.deletedAt,
  );
}

export function sanitizeIssueNote(note: unknown) {
  if (typeof note !== "string") return "";
  return note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}

type SnapshotLike = {
  deliveryLocationLabel?: unknown;
  deliveryAddress?: unknown;
  deliveryInstructions?: unknown;
};

/**
 * Shape a print job for the runner UI. Offered runners see only what they need to decide;
 * assigned runners also see where to deliver. Storage identifiers and URLs are never included.
 */
export function toRunnerPrintMissionView(input: {
  assignmentStatus: string;
  job: {
    id: string;
    status: PrintJobStatus;
    paperSize: string;
    colorMode: string | null;
    sides: string | null;
    copies: number;
    pageSelection: string;
    selectedPageCount: number | null;
    instructions: string | null;
    checkoutSnapshot: unknown;
    document: { originalFileName: string; pageCount: number; deletedAt: Date | null } | null;
    user?: { firstName: string | null; phone: string | null } | null;
  };
}) {
  const { job } = input;
  const snapshot: SnapshotLike = job.checkoutSnapshot && typeof job.checkoutSnapshot === "object" && !Array.isArray(job.checkoutSnapshot)
    ? job.checkoutSnapshot as SnapshotLike
    : {};
  const assigned = input.assignmentStatus === "ACCEPTED" || input.assignmentStatus === "COMPLETED";
  return {
    kind: "PRINT" as const,
    id: job.id,
    reference: printMissionReference(job.id),
    assignmentStatus: input.assignmentStatus,
    status: job.status,
    paperSize: job.paperSize,
    colorMode: job.colorMode,
    sides: job.sides,
    copies: job.copies,
    pageSelection: job.pageSelection,
    selectedPageCount: job.selectedPageCount,
    deliveryLocationLabel: typeof snapshot.deliveryLocationLabel === "string" ? snapshot.deliveryLocationLabel : "Campus delivery",
    ...(assigned
      ? {
          documentName: job.document?.originalFileName ?? null,
          documentPageCount: job.document?.pageCount ?? null,
          documentAvailable: Boolean(job.document && !job.document.deletedAt) && PRINT_DOCUMENT_ACCESS_STATUSES.includes(job.status),
          instructions: job.instructions,
          deliveryAddress: typeof snapshot.deliveryAddress === "string" ? snapshot.deliveryAddress : null,
          deliveryInstructions: typeof snapshot.deliveryInstructions === "string" ? snapshot.deliveryInstructions : null,
          student: job.user ? { firstName: job.user.firstName, phone: job.user.phone } : null,
        }
      : {}),
  };
}

export function printMissionReference(printJobId: string) {
  return `PR-${printJobId.replace(/-/g, "").slice(-8).toUpperCase()}`;
}
