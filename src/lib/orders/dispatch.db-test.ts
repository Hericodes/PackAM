/**
 * Runner dispatch against a disposable database, through the real routes and serializable transactions:
 * offer expiry vs order expiry, redispatch after expiry or decline, retries when nobody is available,
 * concurrent dispatch, refund review, scheduler auth and admin redispatch. Nothing touches a payment provider.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  dbTestSkip as skip,
  signInAs,
  testDb,
  trustedTestVerifiedPayment,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  cart: typeof import("../../app/api/cart/route");
  availability: typeof import("../../app/api/runner/availability/route");
  missions: typeof import("../../app/api/runner/missions/route");
  runnerOrders: typeof import("../../app/api/runner/orders/[id]/route");
  adminOrders: typeof import("../../app/api/admin/orders/[id]/route");
  runDue: typeof import("../../app/api/internal/fulfilment/run-due/route");
  payments: typeof import("../payments/payment-lifecycle");
  dispatch: typeof import("./dispatch");
};
let app: App;
const CRON_SECRET = "test-cron-secret-0123456789abcdef";
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [cart, availability, missions, runnerOrders, adminOrders, runDue, payments, dispatch] = await Promise.all([
    import("../../app/api/cart/route"),
    import("../../app/api/runner/availability/route"),
    import("../../app/api/runner/missions/route"),
    import("../../app/api/runner/orders/[id]/route"),
    import("../../app/api/admin/orders/[id]/route"),
    import("../../app/api/internal/fulfilment/run-due/route"),
    import("../payments/payment-lifecycle"),
    import("./dispatch"),
  ]);
  app = { db, cart, availability, missions, runnerOrders, adminOrders, runDue, payments, dispatch };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;

/** Only the runners a test names are available, so offers are deterministic in a shared test database. */
async function onlyAvailable(...runners: User[]) {
  await app.db.runnerProfile.updateMany({ data: { isAvailable: false } });
  if (runners.length) await app.db.runnerProfile.updateMany({ where: { id: { in: runners.map((r) => r.runnerId) } }, data: { isAvailable: true } });
}

async function paidOrder() {
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Dispatch item", price: 700 }]);
  signInAs(student);
  assert.equal((await callRoute(app.cart.POST, { method: "POST", body: { productId: products[0].id, quantity: 1 } })).status, 200);
  const location = await createTestLocation(student.userId);
  signInAs(student);
  const attempt = await app.payments.createPaymentAttempt("OPAY", location.id, randomUUID());
  const { orderId } = await app.payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));
  return orderId!;
}

const offersFor = (orderId: string) => app.db.runnerAssignment.findMany({ where: { orderId }, select: { runnerId: true, status: true } });
const statusOf = async (orderId: string, runner: User) => (await app.db.runnerAssignment.findFirst({ where: { orderId, runnerId: runner.runnerId }, select: { status: true } }))?.status ?? null;
function act(user: User, orderId: string, action: string) {
  signInAs(user);
  return callRoute(app.runnerOrders.POST, { method: "POST", params: { id: orderId }, body: { action } });
}

test("stranded order: an expired offer doesn't block a runner who comes online later, and they can accept", { skip }, async () => {
  const runnerA = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const runnerB = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  await onlyAvailable(runnerA);
  const orderId = await paidOrder();
  assert.deepEqual(await offersFor(orderId), [{ runnerId: runnerA.runnerId, status: "OFFERED" }]);
  // Paid long ago; A's offer timed out without A responding (the production situation).
  await app.db.order.update({ where: { id: orderId }, data: { findingRunnerAt: minutesAgo(150) } });
  await app.db.runnerAssignment.updateMany({ where: { orderId }, data: { offeredAt: minutesAgo(150) } });

  signInAs(runnerB);
  assert.equal((await callRoute(app.availability.PATCH, { method: "PATCH", body: { available: true } })).status, 200);
  assert.equal(await statusOf(orderId, runnerB), "OFFERED", "offered as soon as B goes available, whatever the order's age");
  signInAs(runnerB);
  const board = await callRoute(app.missions.GET);
  assert.ok((board.json.missions as Array<{ order: { id: string } }>).some((m) => m.order.id === orderId), "visible under New offers");
  signInAs(runnerA);
  assert.ok(!((await callRoute(app.missions.GET)).json.missions as Array<{ order: { id: string } }>).some((m) => m.order.id === orderId), "A's timed-out offer is hidden");

  assert.equal((await act(runnerA, orderId, "accept")).status, 409, "A's own offer has expired");
  assert.equal((await act(runnerB, orderId, "accept")).status, 200, "B's fresh offer can be accepted");
  const order = await app.db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, assignedRunnerId: true } });
  assert.deepEqual(order, { status: "RUNNER_ASSIGNED", assignedRunnerId: runnerB.runnerId });
});

test("declining redispatches to another runner and the decliner is never re-offered", { skip }, async () => {
  const runnerA = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const runnerC = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  await onlyAvailable(runnerA);
  const orderId = await paidOrder();
  await onlyAvailable(runnerA, runnerC); // C comes online without toggling (no automatic offer yet)

  const declined = await act(runnerA, orderId, "decline");
  assert.equal(declined.status, 200, JSON.stringify(declined.json));
  assert.equal(await statusOf(orderId, runnerA), "REJECTED");
  assert.equal(await statusOf(orderId, runnerC), "OFFERED", "redispatched in the same step");
  assert.equal((await act(runnerA, orderId, "decline")).status, 409, "declining twice is refused");
  assert.equal((await act(runnerA, orderId, "accept")).status, 409);
  await app.dispatch.dispatchDueOrders();
  assert.equal((await offersFor(orderId)).filter((o) => o.runnerId === runnerA.runnerId).length, 1, "A is never offered it again");
});

test("with no eligible runner the order stays waiting, and a later run offers the runner who appears", { skip }, async () => {
  await onlyAvailable();
  const orderId = await paidOrder();
  assert.equal((await offersFor(orderId)).length, 0);
  const first = await app.dispatch.redispatchOrderNow(orderId);
  assert.equal(first.outcome, "WAITING_FOR_RUNNERS");
  assert.equal((await app.db.order.findUniqueOrThrow({ where: { id: orderId } })).status, "FINDING_RUNNER", "recoverable, not refunded");

  const runnerE = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  await onlyAvailable(runnerE);
  await app.dispatch.dispatchDueOrders();
  assert.equal(await statusOf(orderId, runnerE), "OFFERED");
});

test("concurrent dispatch runs, admin redispatch and availability toggles create exactly one offer per runner", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  await onlyAvailable();
  const orderId = await paidOrder();
  const runners = await Promise.all([1, 2, 3].map(() => createTestUser("RUNNER", { isVerified: true, isAvailable: false })));
  await onlyAvailable(...runners);

  signInAs(admin);
  const adminRedispatch = callRoute(app.adminOrders.POST, { method: "POST", params: { id: orderId }, body: { action: "redispatch" } });
  await Promise.all([app.dispatch.dispatchDueOrders(), app.dispatch.dispatchDueOrders(), app.dispatch.redispatchOrderNow(orderId), adminRedispatch]);
  const offers = await offersFor(orderId);
  for (const runner of runners) assert.equal(offers.filter((o) => o.runnerId === runner.runnerId).length, 1, runner.runnerId);
  assert.equal(await app.db.auditLog.count({ where: { action: "ORDER_REDISPATCHED", resourceId: orderId, actorId: admin.userId } }), 1);

  // Two runners racing to accept: exactly one wins.
  const results = await Promise.all([act(runners[0], orderId, "accept"), act(runners[1], orderId, "accept")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await app.db.runnerAssignment.count({ where: { orderId, status: "ACCEPTED" } }), 1);
});

test("refund review only after the deadline with nobody left, once, and the refund stays pending", { skip }, async () => {
  const runnerA = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  await onlyAvailable(runnerA);
  const orderId = await paidOrder();
  await app.db.runnerAssignment.updateMany({ where: { orderId }, data: { offeredAt: minutesAgo(60) } });

  await app.db.order.update({ where: { id: orderId }, data: { findingRunnerAt: minutesAgo(60) } });
  await app.dispatch.dispatchDueOrders();
  const early = await app.db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  assert.equal(early.status, "FINDING_RUNNER", "an expired offer before the deadline doesn't expire the order");
  assert.equal(await statusOf(orderId, runnerA), "EXPIRED");

  await app.db.order.update({ where: { id: orderId }, data: { findingRunnerAt: minutesAgo(200) } });
  await app.dispatch.dispatchDueOrders();
  await app.dispatch.dispatchDueOrders();
  const order = await app.db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, refunds: { select: { status: true } } } });
  assert.equal(order.status, "REFUND_PROCESSING");
  assert.deepEqual(order.refunds.map((r) => r.status), ["PENDING"], "one refund request, not marked completed");
  assert.equal((await app.db.payment.findFirstOrThrow({ where: { orderId }, select: { status: true } })).status, "SUCCESS", "the payment record is untouched");
});

test("the scheduled endpoint needs CRON_SECRET, rejects wrong tokens and collapses overlapping runs", { skip }, async () => {
  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await callRoute(app.runDue.GET, { path: "/api/internal/fulfilment/run-due" })).status, 503);
    process.env.CRON_SECRET = CRON_SECRET;
    assert.equal((await callRoute(app.runDue.GET, { path: "/api/internal/fulfilment/run-due" })).status, 401);
    assert.equal((await callRoute(app.runDue.POST, { method: "POST", headers: { authorization: "Bearer wrong-wrong-wrong-wrong" } })).status, 401);
    const first = await callRoute(app.runDue.GET, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.ok("orders" in first.json && "printJobs" in first.json);
    const overlap = await callRoute(app.runDue.POST, { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } });
    assert.equal(overlap.json.skipped, true, "a second run within the lease is skipped, not run twice");
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  }
});
