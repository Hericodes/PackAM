export const eligibleAvailableRunnerWhere = {
  isAvailable: true,
  isVerified: true,
  user: { role: "RUNNER" as const, status: "ACTIVE" as const },
};

export function isEligibleAvailableRunner(runner: {
  isAvailable: boolean;
  isVerified: boolean;
  user: { role: string; status: string };
}) {
  return (
    runner.isAvailable === true &&
    runner.isVerified === true &&
    runner.user.role === "RUNNER" &&
    runner.user.status === "ACTIVE"
  );
}

export function canOfferFindingOrder(order: { status: string; assignedRunnerId: string | null }) {
  return order.status === "FINDING_RUNNER" && !order.assignedRunnerId;
}

export function canOfferFindingPrintJob(job: { status: string; assignedRunnerId: string | null }) {
  return job.status === "FINDING_RUNNER" && !job.assignedRunnerId;
}

export function selectEligibleAvailableRunners<T extends {
  isAvailable: boolean;
  isVerified: boolean;
  user: { role: string; status: string };
}>(runners: T[]) {
  return runners.filter(isEligibleAvailableRunner);
}

export function runnersWithoutExistingOffers<T extends { id: string }>(
  runners: T[],
  alreadyOfferedRunnerIds: Iterable<string>,
) {
  const offered = new Set(alreadyOfferedRunnerIds);
  return runners.filter((runner) => !offered.has(runner.id));
}

export function printAssignmentIdentity(printJobId: string, runnerId: string) {
  return `${printJobId}:${runnerId}`;
}

export function uniqueAssignmentsByPrintJobAndRunner<T extends { printJobId: string | null; runnerId: string }>(
  assignments: T[],
) {
  const seen = new Set<string>();
  return assignments.filter((assignment) => {
    if (!assignment.printJobId) return true;
    const key = printAssignmentIdentity(assignment.printJobId, assignment.runnerId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildMarketplaceMissionOffers(orderId: string, runners: { id: string; userId: string }[]) {
  return {
    assignments: runners.map((runner) => ({
      orderId,
      runnerId: runner.id,
      status: "OFFERED" as const,
    })),
    notifications: runners.map((runner) => ({
      userId: runner.userId,
      type: "DELIVERY" as const,
      title: "New mission 🫡",
      message: "A PackAM order needs a runner.",
      orderId,
      idempotencyKey: `mission-offer:${orderId}:${runner.id}`,
    })),
  };
}

export function buildPrintMissionOffers(printJobId: string, runners: { id: string; userId: string }[]) {
  return {
    assignments: runners.map((runner) => ({
      orderId: null,
      printJobId,
      runnerId: runner.id,
      status: "OFFERED" as const,
    })),
    notifications: runners.map((runner) => ({
      userId: runner.userId,
      type: "DELIVERY" as const,
      title: "New print mission 🫡",
      message: "A paid print job needs a runner.",
      orderId: null,
      relatedType: "PRINT_JOB",
      relatedId: printJobId,
      idempotencyKey: `print-mission-offer:${printJobId}:${runner.id}`,
    })),
  };
}

export function printJobEnterFindingRunnerData(at: Date) {
  return { findingRunnerAt: at };
}

export function planPrintMissionOffersAfterPayment(input: {
  job: { id: string; status: string; assignedRunnerId: string | null; orderId: string | null };
  payment: { orderId: string | null; printJobId: string };
  runners: Array<{
    id: string;
    userId: string;
    isAvailable: boolean;
    isVerified: boolean;
    user: { role: string; status: string };
  }>;
  existingAssignments: Array<{ printJobId: string; runnerId: string }>;
  now: Date;
  firstFinalization: boolean;
}) {
  const jobAfterPayment = {
    ...input.job,
    status: "FINDING_RUNNER" as const,
    assignedRunnerId: null,
  };
  const existingRunnerIds = input.existingAssignments
    .filter((assignment) => assignment.printJobId === input.job.id)
    .map((assignment) => assignment.runnerId);
  const toOffer = runnersWithoutExistingOffers(
    selectEligibleAvailableRunners(input.runners),
    existingRunnerIds,
  );
  const offers = buildPrintMissionOffers(input.job.id, toOffer);
  return {
    findingRunnerAt: input.firstFinalization ? printJobEnterFindingRunnerData(input.now).findingRunnerAt : null,
    jobStatus: jobAfterPayment.status,
    assignedRunnerId: jobAfterPayment.assignedRunnerId,
    createsOrder: false,
    paymentOrderId: input.payment.orderId,
    printJobOrderId: input.job.orderId,
    assignments: uniqueAssignmentsByPrintJobAndRunner(offers.assignments),
    notifications: offers.notifications,
  };
}

export function planPrintOffersWhenRunnerBecomesAvailable(input: {
  runner: {
    id: string;
    userId: string;
    isAvailable: boolean;
    isVerified: boolean;
    user: { role: string; status: string };
  };
  printJobs: Array<{ id: string; status: string; assignedRunnerId: string | null }>;
  existingAssignments: Array<{ printJobId: string; runnerId: string }>;
}) {
  if (!isEligibleAvailableRunner(input.runner)) return [];
  return input.printJobs
    .filter((job) => canOfferFindingPrintJob(job))
    .filter((job) => !input.existingAssignments.some((assignment) => assignment.printJobId === job.id && assignment.runnerId === input.runner.id))
    .map((job) => buildPrintMissionOffers(job.id, [{ id: input.runner.id, userId: input.runner.userId }]));
}
