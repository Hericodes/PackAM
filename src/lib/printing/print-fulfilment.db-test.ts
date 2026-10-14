/**
 * Database-backed print fulfilment tests (race-sensitive acceptance, offer idempotency, authorization).
 * Run with `npm run test:db`; see src/test-support/db-harness.ts for the safety rules.
 */
import { cleanupTestData, createTestUser, dbTestSkip as skip, testDb } from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

type Services = {
  db: Awaited<ReturnType<typeof testDb>>;
  runner: typeof import("./runner-service");
  offers: typeof import("../orders/runner-assignments");
  marketplace: typeof import("../orders/runner-service");
};
let services: Services;

const createUser = (role: "STUDENT" | "RUNNER", runnerProfile?: { isVerified: boolean; isAvailable: boolean }) => createTestUser(role, runnerProfile);

async function createFindingRunnerJob(studentId: string) {
  return services.db.printJob.create({
    data: {
      userId: studentId,
      status: "FINDING_RUNNER",
      findingRunnerAt: new Date(),
      colorMode: "BLACK_AND_WHITE",
      sides: "SINGLE",
      copies: 1,
      selectedPageCount: 1,
      pricePerPage: 100,
      printSubtotal: 100,
      deliveryFee: 200,
      total: 300,
    },
    select: { id: true },
  });
}

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [runner, offers, marketplace] = await Promise.all([
    import("./runner-service"),
    import("../orders/runner-assignments"),
    import("../orders/runner-service"),
  ]);
  services = { db, runner, offers, marketplace };
});
after(cleanupTestData);

test("concurrent acceptance has exactly one winner and consistent state", { skip }, async () => {
  const { db, runner } = services;
  const student = await createUser("STUDENT");
  const runners = await Promise.all(Array.from({ length: 4 }, () => createUser("RUNNER", { isVerified: true, isAvailable: true })));
  const job = await createFindingRunnerJob(student.userId);
  await db.runnerAssignment.createMany({ data: runners.map((r) => ({ printJobId: job.id, runnerId: r.runnerId, status: "OFFERED" as const })) });

  const results = await Promise.allSettled(runners.map((r) => runner.acceptPrintMission(r.userId, job.id)));
  const winners = results.flatMap((result, index) => result.status === "fulfilled" ? [runners[index]] : []);
  assert.equal(winners.length, 1, "exactly one runner wins");
  for (const result of results) {
    if (result.status === "rejected") {
      assert.ok(result.reason instanceof runner.PrintMissionError, String(result.reason));
      assert.equal(result.reason.status, 409);
    }
  }
  const winner = winners[0];

  const stored = await db.printJob.findUniqueOrThrow({ where: { id: job.id }, select: { status: true, assignedRunnerId: true } });
  assert.deepEqual(stored, { status: "RUNNER_ASSIGNED", assignedRunnerId: winner.runnerId });
  const assignments = await db.runnerAssignment.findMany({ where: { printJobId: job.id }, select: { runnerId: true, status: true } });
  assert.deepEqual(assignments.filter((a) => a.status === "ACCEPTED").map((a) => a.runnerId), [winner.runnerId]);
  assert.equal(assignments.filter((a) => a.status === "EXPIRED").length, runners.length - 1);
  assert.equal(await db.printJobStatusHistory.count({ where: { printJobId: job.id, status: "RUNNER_ASSIGNED" } }), 1);

  // Repeated acceptance by the winner is idempotent.
  const again = await runner.acceptPrintMission(winner.userId, job.id);
  assert.equal(again.alreadyAccepted, true);
  assert.equal(await db.printJobStatusHistory.count({ where: { printJobId: job.id, status: "RUNNER_ASSIGNED" } }), 1);
  assert.equal(await db.notification.count({ where: { userId: student.userId, relatedId: job.id, title: "Print runner assigned" } }), 1);

  // Losers can neither advance the job nor reach its document.
  const loser = runners.find((r) => r.runnerId !== winner.runnerId)!;
  await assert.rejects(runner.advancePrintMission(loser.userId, job.id, "document-received"), (error: unknown) => error instanceof runner.PrintMissionError && error.status === 404);
  await assert.rejects(runner.authorizePrintDocumentAccess(loser.userId, job.id), (error: unknown) => error instanceof runner.PrintMissionError && error.status === 404);
  await assert.rejects(runner.acceptPrintMission(loser.userId, job.id), (error: unknown) => error instanceof runner.PrintMissionError && error.status === 409);

  // Duplicate lifecycle actions do not duplicate history.
  await runner.advancePrintMission(winner.userId, job.id, "document-received");
  const duplicate = await runner.advancePrintMission(winner.userId, job.id, "document-received");
  assert.equal(duplicate.alreadyDone, true);
  assert.equal(await db.printJobStatusHistory.count({ where: { printJobId: job.id, status: "DOCUMENT_RECEIVED" } }), 1);
  await assert.rejects(runner.advancePrintMission(winner.userId, job.id, "delivered"), runner.PrintMissionError);

  for (const action of ["start-printing", "printed", "start-delivery", "delivered"] as const) {
    await runner.advancePrintMission(winner.userId, job.id, action);
  }
  const done = await db.printJob.findUniqueOrThrow({ where: { id: job.id }, select: { status: true } });
  assert.equal(done.status, "DELIVERED");
  const completed = await db.runnerAssignment.findFirstOrThrow({ where: { printJobId: job.id, runnerId: winner.runnerId }, select: { status: true, completedAt: true } });
  assert.equal(completed.status, "COMPLETED");
  assert.ok(completed.completedAt);
});

test("print offers are idempotent and limited to eligible runners", { skip }, async () => {
  const { db, offers } = services;
  const student = await createUser("STUDENT");
  const eligible = await createUser("RUNNER", { isVerified: true, isAvailable: true });
  const unverified = await createUser("RUNNER", { isVerified: false, isAvailable: true });
  const offline = await createUser("RUNNER", { isVerified: true, isAvailable: false });
  const job = await createFindingRunnerJob(student.userId);
  const ours = [eligible.runnerId, unverified.runnerId, offline.runnerId];

  await db.$transaction((tx) => offers.offerFindingPrintJobToAvailableRunners(tx, job.id));
  await db.$transaction((tx) => offers.offerFindingPrintJobToAvailableRunners(tx, job.id));
  const created = await db.runnerAssignment.findMany({ where: { printJobId: job.id, runnerId: { in: ours } }, select: { runnerId: true, orderId: true } });
  assert.deepEqual(created, [{ runnerId: eligible.runnerId, orderId: null }]);
  assert.equal(await db.notification.count({ where: { userId: eligible.userId, relatedId: job.id } }), 1);

  // A runner who comes online later receives the waiting print mission once.
  await db.runnerProfile.update({ where: { id: offline.runnerId }, data: { isAvailable: true } });
  await db.$transaction((tx) => offers.offerFindingPrintJobsToRunner(tx, offline.runnerId));
  await db.$transaction((tx) => offers.offerFindingPrintJobsToRunner(tx, offline.runnerId));
  assert.equal(await db.runnerAssignment.count({ where: { printJobId: job.id, runnerId: offline.runnerId } }), 1);
});

async function createFindingRunnerOrder(studentId: string) {
  return services.db.order.create({
    data: {
      userId: studentId,
      status: "FINDING_RUNNER",
      findingRunnerAt: new Date(),
      subtotal: 1_000,
      deliveryFee: 200,
      total: 1_200,
      deliveryAddress: "Test hall",
    },
    select: { id: true },
  });
}

test("the database rejects an assignment with both or neither fulfilment root", { skip }, async () => {
  const { db } = services;
  const student = await createUser("STUDENT");
  const r = await createUser("RUNNER", { isVerified: true, isAvailable: true });
  const job = await createFindingRunnerJob(student.userId);
  const order = await createFindingRunnerOrder(student.userId);
  const violatesRootCheck = (error: unknown) => /RunnerAssignment_one_fulfilment_root_chk/.test(String(error));
  await assert.rejects(db.runnerAssignment.create({ data: { runnerId: r.runnerId, status: "OFFERED" } }), violatesRootCheck);
  await assert.rejects(db.runnerAssignment.create({ data: { runnerId: r.runnerId, orderId: order.id, printJobId: job.id, status: "OFFERED" } }), violatesRootCheck);
  // Exactly one root is accepted, for each kind.
  await db.runnerAssignment.create({ data: { runnerId: r.runnerId, orderId: order.id, status: "OFFERED" } });
  await db.runnerAssignment.create({ data: { runnerId: r.runnerId, printJobId: job.id, status: "OFFERED" } });
  // Per-root uniqueness still holds, and print and order rows with null on the other side do not collide.
  await assert.rejects(db.runnerAssignment.create({ data: { runnerId: r.runnerId, printJobId: job.id, status: "OFFERED" } }));
  await assert.rejects(db.runnerAssignment.create({ data: { runnerId: r.runnerId, orderId: order.id, status: "OFFERED" } }));
});

test("repeated acceptance races on fresh print jobs always produce exactly one winner", { skip }, async () => {
  const { db, runner } = services;
  const student = await createUser("STUDENT");
  const runners = await Promise.all(Array.from({ length: 8 }, () => createUser("RUNNER", { isVerified: true, isAvailable: true })));
  for (let round = 0; round < 15; round += 1) {
    const job = await createFindingRunnerJob(student.userId);
    await db.runnerAssignment.createMany({ data: runners.map((r) => ({ printJobId: job.id, runnerId: r.runnerId, status: "OFFERED" as const })) });
    const results = await Promise.allSettled(runners.map((r) => runner.acceptPrintMission(r.userId, job.id)));
    const winners = results.flatMap((result, index) => result.status === "fulfilled" ? [runners[index].runnerId] : []);
    assert.equal(winners.length, 1, `round ${round}: exactly one winner`);
    for (const result of results) {
      if (result.status === "rejected") assert.ok(result.reason instanceof runner.PrintMissionError && result.reason.status === 409, `round ${round}: ${String(result.reason)}`);
    }
    const stored = await db.printJob.findUniqueOrThrow({ where: { id: job.id }, select: { status: true, assignedRunnerId: true } });
    assert.deepEqual(stored, { status: "RUNNER_ASSIGNED", assignedRunnerId: winners[0] }, `round ${round}`);
    assert.equal(await db.runnerAssignment.count({ where: { printJobId: job.id, status: "ACCEPTED" } }), 1, `round ${round}`);
    assert.equal(await db.runnerAssignment.count({ where: { printJobId: job.id, status: "OFFERED" } }), 0, `round ${round}`);
    assert.equal(await db.printJobStatusHistory.count({ where: { printJobId: job.id, status: "RUNNER_ASSIGNED" } }), 1, `round ${round}`);
  }
});

test("marketplace order offers and acceptance still work on the generalized assignment model", { skip }, async () => {
  const { db, offers, marketplace } = services;
  const student = await createUser("STUDENT");
  const runners = await Promise.all(Array.from({ length: 5 }, () => createUser("RUNNER", { isVerified: true, isAvailable: true })));
  const order = await createFindingRunnerOrder(student.userId);
  const ours = runners.map((r) => r.runnerId);

  await db.$transaction((tx) => offers.offerFindingOrderToAvailableRunners(tx, order.id));
  await db.$transaction((tx) => offers.offerFindingOrderToAvailableRunners(tx, order.id));
  const offered = await db.runnerAssignment.findMany({ where: { orderId: order.id, runnerId: { in: ours } }, select: { printJobId: true, status: true } });
  assert.equal(offered.length, runners.length, "one offer per eligible runner, no duplicates");
  assert.ok(offered.every((a) => a.printJobId === null && a.status === "OFFERED"));

  const results = await Promise.allSettled(runners.map((r) => marketplace.acceptRunnerMission(r.userId, order.id)));
  const winners = results.flatMap((result, index) => result.status === "fulfilled" ? [runners[index].runnerId] : []);
  assert.equal(winners.length, 1, "exactly one marketplace winner");
  const stored = await db.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, assignedRunnerId: true } });
  assert.deepEqual(stored, { status: "RUNNER_ASSIGNED", assignedRunnerId: winners[0] });
  assert.equal(await db.runnerAssignment.count({ where: { orderId: order.id, status: "ACCEPTED" } }), 1);
  assert.equal(await db.runnerAssignment.count({ where: { orderId: order.id, status: "OFFERED" } }), 0);
});
