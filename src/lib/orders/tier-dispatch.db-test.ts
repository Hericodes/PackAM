/**
 * Delivery-tier dispatch against a disposable database: Oya Now! and Sharp Sharp go first and only to runners with
 * no active mission until they escalate (one admin alert, however many passes race), nobody stacks work on an
 * urgent mission, Cruise Mode and orders without a tier dispatch as before, and the runner board explains it all.
 *
 * Fixtures are built directly, the way completeVerifiedPayment leaves a paid order: in one serializable transaction
 * the FINDING_RUNNER order, its OrderDeliveryTier row (none for an order paid before tiers) and the payment-time
 * offers. So these tests never depend on the payment flow. Nothing touches a payment provider.
 * Tier tests skip on a database without migration 20261101150000_delivery_tiers; the last test runs only there.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestUser,
  createTestVendor,
  dbTestSkip as skip,
  deliveryTierTablesMigrated,
  signInAs,
  testDb,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  DELIVERY_TIER_LABELS,
  HOLDS_URGENT_MISSION_MESSAGE,
  STANDARD_DELIVERY_LABEL,
  URGENT_ESCALATION_TITLE,
  URGENT_NEEDS_IDLE_RUNNER_MESSAGE,
  deliveryDueAt,
  formatEta,
  urgentEscalationMessage,
  type DeliveryTierCode,
} from "../delivery-tiers";
import { shortReference } from "../student-copy";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  missions: typeof import("../../app/api/runner/missions/route");
  missionDetail: typeof import("../../app/api/runner/missions/[id]/route");
  runnerOrders: typeof import("../../app/api/runner/orders/[id]/route");
  availability: typeof import("../../app/api/runner/availability/route");
  adminOrders: typeof import("../../app/api/admin/orders/[id]/route");
  dispatch: typeof import("./dispatch");
  offers: typeof import("./runner-assignments");
  store: typeof import("../delivery-tier-store");
  print: typeof import("../printing/runner-service");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [missions, missionDetail, runnerOrders, availability, adminOrders, dispatch, offers, store, print] = await Promise.all([
    import("../../app/api/runner/missions/route"),
    import("../../app/api/runner/missions/[id]/route"),
    import("../../app/api/runner/orders/[id]/route"),
    import("../../app/api/runner/availability/route"),
    import("../../app/api/admin/orders/[id]/route"),
    import("./dispatch"),
    import("./runner-assignments"),
    import("../delivery-tier-store"),
    import("../printing/runner-service"),
  ]);
  app = { db, missions, missionDetail, runnerOrders, availability, adminOrders, dispatch, offers, store, print };
});
after(cleanupTestData);

const NOT_MIGRATED = "delivery-tier migration not applied to this test database";
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

type User = Awaited<ReturnType<typeof createTestUser>>;
type Delivery = { tier: string | null; label: string; urgent: boolean; eta: string | null; dueAt: string | null };
type Acceptance = { allowed: boolean; reason: string | null };
type BoardMission = { status: string; delivery: Delivery; acceptance?: Acceptance; order: { id: string; findingRunnerAt: string | null } };
type BoardPrintMission = { id: string; assignmentStatus: string; offeredAt: string; acceptance?: Acceptance };

const verifiedRunner = () => createTestUser("RUNNER", { isVerified: true, isAvailable: true });

/** Only the runners a test names are available, so offers are deterministic in a shared test database. */
async function onlyAvailable(...runners: User[]) {
  await app.db.runnerProfile.updateMany({ data: { isAvailable: false } });
  if (runners.length) await app.db.runnerProfile.updateMany({ where: { id: { in: runners.map((r) => r.runnerId) } }, data: { isAvailable: true } });
}

let product: { id: string; name: string } | null = null;
async function testProduct() {
  if (!product) product = (await createTestCatalogue([{ name: "Tier dispatch item", price: 700 }])).products[0];
  return product;
}

const TIER_FIXTURE: Record<DeliveryTierCode, { fee: number; etaMin: number; etaMax: number }> = {
  CRUISE: { fee: 200, etaMin: 20, etaMax: 30 },
  SHARP: { fee: 300, etaMin: 15, etaMax: 25 },
  OYA: { fee: 400, etaMin: 10, etaMax: 15 },
};

/**
 * A paid order looking for a runner, as completeVerifiedPayment leaves it: the order, its delivery tier row (none
 * for `null`, an order paid before tiers) and the payment-time offers, in one serializable transaction.
 */
async function paidOrder(tier: DeliveryTierCode | null) {
  const student = await createTestUser("STUDENT");
  const item = await testProduct();
  const fee = tier ? TIER_FIXTURE[tier].fee : 200;
  const confirmedAt = new Date();
  return app.db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId: student.userId,
        status: "FINDING_RUNNER",
        findingRunnerAt: confirmedAt,
        subtotal: 700,
        deliveryFee: fee,
        total: 700 + fee,
        deliveryAddress: "Room 1, Test Hall, OOU",
        items: { create: [{ productId: item.id, productName: item.name, unitPrice: 700, quantity: 1, totalPrice: 700 }] },
      },
      select: { id: true },
    });
    if (tier) {
      const { etaMin, etaMax } = TIER_FIXTURE[tier];
      const written = await app.store.writeOrderDeliveryTierInTransaction(tx, {
        orderId: order.id, tier, etaMinMinutes: etaMin, etaMaxMinutes: etaMax, dueAt: deliveryDueAt(confirmedAt, etaMax), settingsVersion: 1,
      });
      assert.equal(written, true, "the tier row is written");
    }
    await app.offers.offerFindingOrderToAvailableRunners(tx, order.id);
    return order.id;
  }, { isolationLevel: "Serializable" });
}

/** A paid print job looking for a runner, offered to the runners available right now. */
async function offeredPrintJob() {
  const student = await createTestUser("STUDENT");
  const job = await app.db.printJob.create({
    data: {
      userId: student.userId, status: "FINDING_RUNNER", findingRunnerAt: new Date(), colorMode: "BLACK_AND_WHITE", sides: "SINGLE",
      copies: 1, selectedPageCount: 1, pricePerPage: 100, printSubtotal: 100, deliveryFee: 200, total: 300,
    },
    select: { id: true },
  });
  await app.db.$transaction((tx) => app.offers.offerFindingPrintJobToAvailableRunners(tx, job.id));
  return job.id;
}

const startedMinutesAgo = (orderId: string, minutes: number) => app.db.order.update({ where: { id: orderId }, data: { findingRunnerAt: minutesAgo(minutes) } });
const statusOf = async (orderId: string, runner: User) => (await app.db.runnerAssignment.findFirst({ where: { orderId, runnerId: runner.runnerId }, select: { status: true } }))?.status ?? null;
const escalatedAt = async (orderId: string) => (await app.db.orderDeliveryTier.findUniqueOrThrow({ where: { orderId }, select: { escalatedAt: true } })).escalatedAt;
const escalationAlerts = (admin: User, orderId: string) => app.db.notification.count({ where: { userId: admin.userId, orderId, title: URGENT_ESCALATION_TITLE } });

function act(user: User, orderId: string, action: string, body: Record<string, unknown> = {}) {
  signInAs(user);
  return callRoute(app.runnerOrders.POST, { method: "POST", params: { id: orderId }, body: { action, ...body } });
}

async function accepted(runner: User, orderId: string) {
  const result = await act(runner, orderId, "accept");
  assert.equal(result.status, 200, `accept: ${JSON.stringify(result.json)}`);
}

/** Through the runner API, as marketplace-journey does: source the item, start delivery, mark delivered. */
async function deliver(runner: User, orderId: string) {
  const vendor = await createTestVendor("Tier shop");
  const item = await app.db.orderItem.findFirstOrThrow({ where: { orderId }, select: { id: true, quantity: true, unitPrice: true } });
  const steps: Array<[string, Record<string, unknown>]> = [
    ["source", { orderItemId: item.id, vendorId: vendor.id, result: "AVAILABLE", quantity: item.quantity, actualUnitPrice: item.unitPrice }],
    ["start-delivery", {}],
    ["delivered", {}],
  ];
  for (const [action, body] of steps) {
    const result = await act(runner, orderId, action, body);
    assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.json)}`);
  }
}

async function board(runner: User) {
  signInAs(runner);
  const result = await callRoute(app.missions.GET);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  return { missions: result.json.missions as BoardMission[], printMissions: result.json.printMissions as BoardPrintMission[] };
}

async function detail(runner: User, orderId: string) {
  signInAs(runner);
  const result = await callRoute(app.missionDetail.GET, { params: { id: orderId } });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  return result.json.mission as { assignmentStatus: string; delivery: Delivery; acceptance?: Acceptance };
}

test("Oya Now! is offered only to runners with no active missions until it escalates, then to everyone, with one admin alert", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const admin = await createTestUser("ADMIN");
  const idle = await verifiedRunner();
  const busy = await verifiedRunner();
  await onlyAvailable(busy);
  await accepted(busy, await paidOrder("CRUISE"));
  await onlyAvailable(idle, busy);

  const orderId = await paidOrder("OYA");
  assert.equal(await statusOf(orderId, idle), "OFFERED", "the idle runner is offered it at payment");
  assert.equal(await statusOf(orderId, busy), null, "a runner with an active mission is not");
  // Before the threshold a pass changes nothing: no alert, no wider offers.
  const early = await app.dispatch.redispatchOrderNow(orderId);
  assert.equal(early.escalated, false);
  assert.equal(await statusOf(orderId, busy), null);
  assert.equal(await escalatedAt(orderId), null);
  assert.equal(await escalationAlerts(admin, orderId), 0);

  await startedMinutesAgo(orderId, 6);
  const summary = await app.dispatch.dispatchDueOrders();
  assert.ok(summary.escalations >= 1, JSON.stringify(summary));
  assert.ok(await escalatedAt(orderId), "escalatedAt is set");
  assert.equal(await statusOf(orderId, busy), "OFFERED", "after escalation it goes to every eligible runner");
  const alerts = await app.db.notification.findMany({ where: { userId: admin.userId, orderId, title: URGENT_ESCALATION_TITLE }, select: { type: true, message: true } });
  assert.deepEqual(alerts, [{ type: "DELIVERY", message: urgentEscalationMessage("OYA", shortReference(orderId)) }], "one alert for this admin");

  // The busy runner (still holding a Cruise Mode order) can now take it.
  await accepted(busy, orderId);
  const order = await app.db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, assignedRunnerId: true } });
  assert.deepEqual(order, { status: "RUNNER_ASSIGNED", assignedRunnerId: busy.runnerId });
});

test("Sharp Sharp escalates at 10 minutes, not before", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const admin = await createTestUser("ADMIN");
  const idle = await verifiedRunner();
  const busy = await verifiedRunner();
  await onlyAvailable(busy);
  await accepted(busy, await paidOrder("CRUISE"));
  await onlyAvailable(idle, busy);

  const orderId = await paidOrder("SHARP");
  assert.equal(await statusOf(orderId, idle), "OFFERED");
  assert.equal(await statusOf(orderId, busy), null);

  await startedMinutesAgo(orderId, 6);
  await app.dispatch.dispatchDueOrders();
  assert.equal(await escalatedAt(orderId), null, "not escalated at 6 minutes");
  assert.equal(await escalationAlerts(admin, orderId), 0);
  assert.equal(await statusOf(orderId, busy), null, "still only for runners with no active missions");
  // Going available again doesn't get a busy runner the held-back order either.
  signInAs(busy);
  assert.equal((await callRoute(app.availability.PATCH, { method: "PATCH", body: { available: true } })).status, 200);
  assert.equal(await statusOf(orderId, busy), null);

  await startedMinutesAgo(orderId, 11);
  await app.dispatch.dispatchDueOrders();
  assert.ok(await escalatedAt(orderId), "escalated at 11 minutes");
  assert.equal(await escalationAlerts(admin, orderId), 1);
  const alert = await app.db.notification.findFirstOrThrow({ where: { userId: admin.userId, orderId, title: URGENT_ESCALATION_TITLE }, select: { message: true } });
  assert.equal(alert.message, urgentEscalationMessage("SHARP", shortReference(orderId)));
  assert.match(alert.message, /within 10 minutes/);
  assert.equal(await statusOf(orderId, busy), "OFFERED", "the offers widen");
});

test("escalation alerts each admin exactly once across repeated and concurrent dispatch runs", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const admins = [await createTestUser("ADMIN"), await createTestUser("ADMIN")];
  const runner = await verifiedRunner();
  await onlyAvailable(runner);
  // One order escalated by sequential passes first, one whose first escalation is the concurrent burst itself.
  const sequential = await paidOrder("OYA");
  const racing = await paidOrder("SHARP");
  await startedMinutesAgo(sequential, 6);
  await app.dispatch.dispatchDueOrders();
  await app.dispatch.dispatchDueOrders();
  const first = await escalatedAt(sequential);
  assert.ok(first);
  assert.equal(await escalatedAt(racing), null, "Sharp Sharp isn't due yet");

  await startedMinutesAgo(racing, 11);
  signInAs(admins[0]);
  const adminRedispatch = callRoute(app.adminOrders.POST, { method: "POST", params: { id: racing }, body: { action: "redispatch" } });
  const results = await Promise.all([
    app.dispatch.dispatchDueOrders(),
    app.dispatch.dispatchDueOrders(),
    app.dispatch.redispatchOrderNow(sequential),
    app.dispatch.redispatchOrderNow(racing),
    adminRedispatch,
  ]);
  assert.equal(results[4].status, 200, JSON.stringify(results[4].json));

  for (const admin of admins) {
    assert.equal(await escalationAlerts(admin, sequential), 1, "sequential: one alert per admin");
    assert.equal(await escalationAlerts(admin, racing), 1, "racing: one alert per admin");
  }
  assert.deepEqual(await escalatedAt(sequential), first, "escalatedAt is never moved");
  const racedAt = await escalatedAt(racing);
  assert.ok(racedAt);
  await app.dispatch.dispatchDueOrders();
  assert.deepEqual(await escalatedAt(racing), racedAt);
  for (const admin of admins) assert.equal(await escalationAlerts(admin, racing), 1);
  // The redispatch audit records the escalation flag with the rest of the step's result.
  const audit = await app.db.auditLog.findFirstOrThrow({ where: { action: "ORDER_REDISPATCHED", resourceId: racing, actorId: admins[0].userId }, select: { newState: true } });
  assert.equal(typeof (audit.newState as { escalated?: unknown }).escalated, "boolean");
});

test("no stacking: a runner holding an Oya Now! order can't accept another mission until they deliver it", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const runner = await verifiedRunner();
  await onlyAvailable(runner);
  const urgent = await paidOrder("OYA");
  await accepted(runner, urgent);

  // Busy runners still get Cruise Mode and print offers (and see why they can't take them).
  const cruise = await paidOrder("CRUISE");
  assert.equal(await statusOf(cruise, runner), "OFFERED");
  const refused = await act(runner, cruise, "accept");
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error, HOLDS_URGENT_MISSION_MESSAGE);
  assert.match(String(refused.json.error), /mission/);
  assert.equal(await statusOf(cruise, runner), "OFFERED", "the refused offer stays open");
  assert.equal((await app.db.order.findUniqueOrThrow({ where: { id: cruise }, select: { status: true } })).status, "FINDING_RUNNER");

  const printJobId = await offeredPrintJob();
  await assert.rejects(app.print.acceptPrintMission(runner.userId, printJobId), (error: unknown) =>
    error instanceof app.print.PrintMissionError && error.status === 409 && error.message === HOLDS_URGENT_MISSION_MESSAGE);

  await deliver(runner, urgent);
  await accepted(runner, cruise);
  const print = await app.print.acceptPrintMission(runner.userId, printJobId);
  assert.equal(print.accepted, true, "a print mission can join a Cruise Mode order");
  assert.equal((await app.db.printJob.findUniqueOrThrow({ where: { id: printJobId }, select: { assignedRunnerId: true } })).assignedRunnerId, runner.runnerId);

  // An idle runner accepting two urgent orders at once ends up with exactly one (Serializable + retry).
  const racer = await verifiedRunner();
  await onlyAvailable(racer);
  const both = [await paidOrder("OYA"), await paidOrder("SHARP")];
  const results = await Promise.all(both.map((orderId) => act(racer, orderId, "accept")));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409], JSON.stringify(results.map((result) => result.json)));
  assert.ok(results.every((result) => result.status === 200 || [HOLDS_URGENT_MISSION_MESSAGE, URGENT_NEEDS_IDLE_RUNNER_MESSAGE].includes(String(result.json.error))), JSON.stringify(results.map((result) => result.json)));
  assert.equal(await app.db.runnerAssignment.count({ where: { runnerId: racer.runnerId, status: "ACCEPTED" } }), 1);
});

test("Cruise Mode batches as before", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const admin = await createTestUser("ADMIN");
  const runner = await verifiedRunner();
  await onlyAvailable(runner);
  const first = await paidOrder("CRUISE");
  const second = await paidOrder("CRUISE");
  await startedMinutesAgo(first, 600);
  await startedMinutesAgo(second, 600);
  for (const orderId of [first, second]) {
    const result = await app.dispatch.redispatchOrderNow(orderId);
    assert.deepEqual({ outcome: result.outcome, escalated: result.escalated }, { outcome: "WAITING_ON_OFFERS", escalated: false });
  }
  await app.dispatch.dispatchDueOrders();

  await accepted(runner, first);
  await accepted(runner, second);
  assert.equal(await app.db.runnerAssignment.count({ where: { runnerId: runner.runnerId, status: "ACCEPTED" } }), 2, "one runner, two Cruise Mode orders");
  for (const orderId of [first, second]) {
    assert.equal(await escalatedAt(orderId), null);
    assert.equal(await escalationAlerts(admin, orderId), 0);
  }
});

test("orders without a tier row dispatch exactly as before", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const admin = await createTestUser("ADMIN");
  const busy = await verifiedRunner();
  const other = await verifiedRunner();
  await onlyAvailable(busy);
  await accepted(busy, await paidOrder(null));
  await onlyAvailable(busy, other);

  const orderId = await paidOrder(null);
  assert.equal(await app.db.orderDeliveryTier.count({ where: { orderId } }), 0, "no tier row: paid before delivery tiers");
  assert.equal(await statusOf(orderId, busy), "OFFERED", "busy runners are offered it");
  assert.equal(await statusOf(orderId, other), "OFFERED");
  await startedMinutesAgo(orderId, 60);
  assert.equal((await app.dispatch.redispatchOrderNow(orderId)).escalated, false);
  await app.dispatch.dispatchDueOrders();
  assert.equal(await escalationAlerts(admin, orderId), 0);

  const offer = (await board(busy)).missions.find((mission) => mission.order.id === orderId);
  assert.deepEqual(offer?.delivery, { tier: null, label: STANDARD_DELIVERY_LABEL, urgent: false, eta: null, dueAt: null });
  assert.deepEqual(offer?.acceptance, { allowed: true, reason: null });
  await accepted(busy, orderId);
  assert.equal(await app.db.orderDeliveryTier.count({ where: { orderId } }), 0, "nothing is backfilled");
});

test("urgent orders come first in the dispatch batch", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  await onlyAvailable();
  const cruise = await paidOrder("CRUISE");
  const sharp = await paidOrder("SHARP");
  const oya = await paidOrder("OYA");
  const legacy = await paidOrder(null);
  try {
    // The Cruise Mode order and the order without a tier have waited longest, yet the urgent ones go first.
    await startedMinutesAgo(cruise, 90);
    await startedMinutesAgo(legacy, 60);
    const candidates = await app.dispatch.selectDispatchCandidates(50);
    const at = (orderId: string) => candidates.indexOf(orderId);
    for (const orderId of [oya, sharp, cruise, legacy]) assert.ok(at(orderId) >= 0, `${orderId} is in the batch: ${JSON.stringify(candidates)}`);
    assert.ok(at(oya) < at(sharp), "Oya Now! before Sharp Sharp");
    assert.ok(at(sharp) < at(cruise), "Sharp Sharp before an older Cruise Mode order");
    assert.ok(at(cruise) < at(legacy), "then everything else, oldest first");
    assert.equal(new Set(candidates).size, candidates.length, "no order twice");
  } finally {
    // Out of the way of later passes in this file.
    await app.db.order.updateMany({ where: { id: { in: [cruise, sharp, oya, legacy] } }, data: { status: "CANCELLED" } });
  }
});

test("runner board and mission detail show tier, due time and blocked offers", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const runner = await verifiedRunner();
  await onlyAvailable(runner);
  const urgent = await paidOrder("OYA");
  const cruise = await paidOrder("CRUISE");
  await accepted(runner, cruise);
  const urgentRow = await app.db.orderDeliveryTier.findUniqueOrThrow({ where: { orderId: urgent }, select: { dueAt: true } });
  const cruiseRow = await app.db.orderDeliveryTier.findUniqueOrThrow({ where: { orderId: cruise }, select: { dueAt: true } });
  const urgentDelivery = { tier: "OYA", label: DELIVERY_TIER_LABELS.OYA, urgent: true, eta: formatEta(10, 15, "short"), dueAt: urgentRow.dueAt.toISOString() };

  // Offered while idle, now busy with a Cruise Mode order: the Oya Now! offer shows, blocked, with the reason.
  const view = await board(runner);
  const offer = view.missions.find((mission) => mission.order.id === urgent);
  assert.equal(offer?.status, "OFFERED");
  assert.deepEqual(offer?.delivery, urgentDelivery);
  assert.deepEqual(offer?.acceptance, { allowed: false, reason: URGENT_NEEDS_IDLE_RUNNER_MESSAGE });
  assert.ok(offer?.order.findingRunnerAt, "waiting time for sorting");
  const mine = view.missions.find((mission) => mission.order.id === cruise);
  assert.equal(mine?.status, "ACCEPTED");
  assert.deepEqual(mine?.delivery, { tier: "CRUISE", label: DELIVERY_TIER_LABELS.CRUISE, urgent: false, eta: formatEta(20, 30, "short"), dueAt: cruiseRow.dueAt.toISOString() });
  assert.equal(mine && "acceptance" in mine, false, "only offers carry acceptance");

  const shown = await detail(runner, urgent);
  assert.equal(shown.assignmentStatus, "OFFERED");
  assert.deepEqual(shown.delivery, urgentDelivery);
  assert.deepEqual(shown.acceptance, { allowed: false, reason: URGENT_NEEDS_IDLE_RUNNER_MESSAGE });
  const refused = await act(runner, urgent, "accept");
  assert.deepEqual({ status: refused.status, error: refused.json.error }, { status: 409, error: URGENT_NEEDS_IDLE_RUNNER_MESSAGE }, "the server enforces what the board shows");

  // A runner holding an urgent order sees every other offer blocked, prints included.
  const holder = await verifiedRunner();
  await onlyAvailable(holder);
  await accepted(holder, await paidOrder("SHARP"));
  const waiting = await paidOrder("CRUISE");
  const printJobId = await offeredPrintJob();
  const holderView = await board(holder);
  assert.deepEqual(holderView.missions.find((mission) => mission.order.id === waiting)?.acceptance, { allowed: false, reason: HOLDS_URGENT_MISSION_MESSAGE });
  const printOffer = holderView.printMissions.find((mission) => mission.id === printJobId);
  assert.equal(printOffer?.assignmentStatus, "OFFERED");
  assert.deepEqual(printOffer?.acceptance, { allowed: false, reason: HOLDS_URGENT_MISSION_MESSAGE });
  assert.ok(printOffer?.offeredAt, "print offers carry their offer time for sorting");
  const waitingDetail = await detail(holder, waiting);
  assert.deepEqual(waitingDetail.acceptance, { allowed: false, reason: HOLDS_URGENT_MISSION_MESSAGE });
  assert.equal(waitingDetail.delivery.label, DELIVERY_TIER_LABELS.CRUISE);
});

test("a runner who delivers their last mission is offered waiting urgent orders straight away", { skip }, async (t) => {
  if (!(await deliveryTierTablesMigrated())) return t.skip(NOT_MIGRATED);
  const runner = await verifiedRunner();
  await onlyAvailable(runner);
  const cruise = await paidOrder("CRUISE");
  await accepted(runner, cruise);
  const urgent = await paidOrder("OYA");
  assert.equal(await statusOf(urgent, runner), null, "nobody idle to offer it to");

  await deliver(runner, cruise);
  assert.equal(await statusOf(urgent, runner), "OFFERED", "offered as soon as the delivery is done, without a scheduled pass");
  await accepted(runner, urgent);

  // The same after delivering a print job.
  const printer = await verifiedRunner();
  await onlyAvailable(printer);
  const printJobId = await offeredPrintJob();
  assert.equal((await app.print.acceptPrintMission(printer.userId, printJobId)).accepted, true);
  const next = await paidOrder("SHARP");
  assert.equal(await statusOf(next, printer), null, "held back while the print job is in progress");
  for (const step of ["document-received", "start-printing", "printed", "start-delivery", "delivered"] as const) {
    await app.print.advancePrintMission(printer.userId, printJobId, step);
  }
  assert.equal(await statusOf(next, printer), "OFFERED");
});

test("before the migration dispatch, offers and acceptance behave exactly as today", { skip }, async (t) => {
  if (await deliveryTierTablesMigrated()) return t.skip("runs only on a database without the delivery-tier migration");
  const admin = await createTestUser("ADMIN");
  const busy = await verifiedRunner();
  const other = await verifiedRunner();
  await onlyAvailable(busy);
  await accepted(busy, await paidOrder(null));
  await onlyAvailable(busy, other);

  const older = await paidOrder(null);
  const newer = await paidOrder(null);
  for (const orderId of [older, newer]) {
    assert.equal(await statusOf(orderId, busy), "OFFERED", "payment-time offers go to busy runners too");
    assert.equal(await statusOf(orderId, other), "OFFERED");
  }
  assert.equal((await app.store.loadOrderDeliveryTiers(app.db, [older, newer])).size, 0);
  await startedMinutesAgo(older, 60);
  const candidates = await app.dispatch.selectDispatchCandidates(500);
  assert.ok(candidates.indexOf(older) >= 0 && candidates.indexOf(older) < candidates.indexOf(newer), "oldest first, as before");
  const result = await app.dispatch.redispatchOrderNow(older);
  assert.equal(result.escalated, false);
  await app.dispatch.dispatchDueOrders();
  assert.equal(await app.db.notification.count({ where: { userId: admin.userId, title: URGENT_ESCALATION_TITLE } }), 0);

  const offer = (await board(busy)).missions.find((mission) => mission.order.id === older);
  assert.deepEqual(offer?.delivery, { tier: null, label: STANDARD_DELIVERY_LABEL, urgent: false, eta: null, dueAt: null });
  assert.deepEqual(offer?.acceptance, { allowed: true, reason: null });
  const shown = await detail(busy, older);
  assert.deepEqual(shown.delivery, { tier: null, label: STANDARD_DELIVERY_LABEL, urgent: false, eta: null, dueAt: null });
  assert.deepEqual(shown.acceptance, { allowed: true, reason: null });
  await accepted(busy, older);
  await accepted(busy, newer);
  assert.equal(await app.db.runnerAssignment.count({ where: { runnerId: busy.runnerId, status: "ACCEPTED" } }), 3, "busy runners batch as before");

  // Nothing is held back for idle runners, so finishing a delivery offers nothing early: the next pass does, as today.
  const solo = await verifiedRunner();
  await onlyAvailable(solo);
  const job = await paidOrder(null);
  await accepted(solo, job);
  await onlyAvailable();
  const waiting = await paidOrder(null);
  await onlyAvailable(solo);
  await deliver(solo, job);
  assert.equal(await statusOf(waiting, solo), null, "no offer until the next scheduled pass");
  await app.dispatch.redispatchOrderNow(waiting);
  assert.equal(await statusOf(waiting, solo), "OFFERED");
});
