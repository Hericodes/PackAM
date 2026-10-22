/**
 * Marketplace journey against a disposable database: search → cart → checkout attempt →
 * trusted test payment boundary → offers → competing acceptance → sourcing → delivery,
 * plus unavailable items, price changes, timeouts and cross-role access.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  asUser,
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  createTestVendor,
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
  search: typeof import("../../app/api/search/route");
  orderApi: typeof import("../../app/api/orders/[id]/route");
  runnerOrders: typeof import("../../app/api/runner/orders/[id]/route");
  runnerMission: typeof import("../../app/api/runner/missions/[id]/route");
  runnerMissions: typeof import("../../app/api/runner/missions/route");
  adminOrders: typeof import("../../app/api/admin/orders/[id]/route");
  payments: typeof import("../payments/payment-lifecycle");
  scheduled: typeof import("./scheduled-work");
  checkoutPricing: typeof import("../checkout-pricing");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [cart, search, orderApi, runnerOrders, runnerMission, runnerMissions, adminOrders, payments, scheduled, checkoutPricing] = await Promise.all([
    import("../../app/api/cart/route"),
    import("../../app/api/search/route"),
    import("../../app/api/orders/[id]/route"),
    import("../../app/api/runner/orders/[id]/route"),
    import("../../app/api/runner/missions/[id]/route"),
    import("../../app/api/runner/missions/route"),
    import("../../app/api/admin/orders/[id]/route"),
    import("../payments/payment-lifecycle"),
    import("./scheduled-work"),
    import("../checkout-pricing"),
  ]);
  app = { db, cart, search, orderApi, runnerOrders, runnerMission, runnerMissions, adminOrders, payments, scheduled, checkoutPricing };
});
after(cleanupTestData);

type Student = Awaited<ReturnType<typeof createTestUser>>;

/** Puts items in the cart through the real cart API and opens a real pending payment attempt. */
async function checkout(student: Student, items: Array<{ productId: string; quantity: number }>) {
  signInAs(student);
  for (const item of items) {
    const added = await callRoute(app.cart.POST, { method: "POST", path: "/api/cart", body: item });
    assert.equal(added.status, 200, JSON.stringify(added.json));
  }
  const location = await createTestLocation(student.userId);
  signInAs(student);
  const attempt = await app.payments.createPaymentAttempt("OPAY", location.id, randomUUID());
  return { attempt, location };
}

async function paidOrder(student: Student, items: Array<{ productId: string; quantity: number }>) {
  const { attempt } = await checkout(student, items);
  const result = await app.payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));
  return result.orderId!;
}

test("student search, cart editing and checkout pricing use server prices", { skip }, async () => {
  const { db, cart, search, checkoutPricing } = app;
  const student = await createTestUser("STUDENT");
  const other = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const { products, categorySlug } = await createTestCatalogue([{ name: "Indomie carton", price: 1_500 }, { name: "A4 notebook", price: 400 }]);
  const [noodles, notebook] = products;

  // Browsing a category with no search text lists that category (regression: it used to return nothing).
  signInAs(null);
  const browsed = await callRoute(search.GET, { path: `/api/search?category=${categorySlug}` });
  assert.equal(browsed.status, 200);
  assert.deepEqual(new Set((browsed.json.products as Array<{ id: string }>).map((p) => p.id)), new Set([noodles.id, notebook.id]));

  signInAs(student);
  const found = await callRoute(search.GET, { path: `/api/search?q=${encodeURIComponent(noodles.name.slice(0, 12))}` });
  assert.equal(found.status, 200);
  assert.match(JSON.stringify(found.json), new RegExp(noodles.id));

  assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: noodles.id, quantity: 1 } })).status, 200);
  assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: noodles.id, quantity: 1 } })).status, 200, "adding again merges quantity");
  assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: notebook.id, quantity: 3 } })).status, 200);
  for (const quantity of [0, 100, 1.5, -2]) {
    assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: noodles.id, quantity } })).status, 400, `quantity ${quantity}`);
  }
  assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: randomUUID(), quantity: 1 } })).status, 404);

  const items = await db.cartItem.findMany({ where: { cart: { userId: student.userId } }, select: { id: true, productId: true, quantity: true } });
  const noodleItem = items.find((item) => item.productId === noodles.id)!;
  const notebookItem = items.find((item) => item.productId === notebook.id)!;
  assert.equal(noodleItem.quantity, 2);

  // Another student cannot edit or remove this cart item; a runner cannot use carts at all.
  signInAs(other);
  assert.equal((await callRoute(cart.PATCH, { method: "PATCH", body: { itemId: noodleItem.id, quantity: 9 } })).status, 404);
  assert.equal((await callRoute(cart.DELETE, { method: "DELETE", body: { itemId: noodleItem.id } })).status, 404);
  signInAs(runner);
  assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: noodles.id } })).status, 403);
  signInAs(null);
  assert.equal((await callRoute(cart.GET)).status, 401);

  signInAs(student);
  assert.equal((await callRoute(cart.PATCH, { method: "PATCH", body: { itemId: noodleItem.id, quantity: 3 } })).status, 200);
  assert.equal((await callRoute(cart.DELETE, { method: "DELETE", body: { itemId: notebookItem.id } })).status, 200);
  const summary = await callRoute(cart.GET);
  assert.equal(summary.status, 200);

  const location = await createTestLocation(student.userId);
  signInAs(student);
  const key = randomUUID();
  const attempt = await app.payments.createPaymentAttempt("OPAY", location.id, key);
  assert.equal(attempt.status, "PENDING");
  assert.equal(attempt.amount, 3 * 1_500 + checkoutPricing.CHECKOUT_DELIVERY_FEE, "server price × quantity + delivery fee");
  const retried = await app.payments.createPaymentAttempt("OPAY", location.id, key);
  assert.equal(retried.id, attempt.id, "retrying with the same key reuses the attempt");

  // Checkout can't use another student's saved location.
  const foreignLocation = await createTestLocation(other.userId);
  signInAs(student);
  await assert.rejects(app.payments.createPaymentAttempt("OPAY", foreignLocation.id, randomUUID()), /saved delivery locations/i);
});

test("verified payment creates one order, offers only eligible runners, and duplicate callbacks are idempotent", { skip }, async () => {
  const { db, payments } = app;
  const student = await createTestUser("STUDENT");
  const eligible = await Promise.all([1, 2, 3].map(() => createTestUser("RUNNER", { isVerified: true, isAvailable: true })));
  const unverified = await createTestUser("RUNNER", { isVerified: false, isAvailable: true });
  const offline = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  const { products } = await createTestCatalogue([{ name: "Gala", price: 300 }]);
  const { attempt } = await checkout(student, [{ productId: products[0].id, quantity: 2 }]);

  // Nothing is created before verification.
  assert.equal(await db.order.count({ where: { userId: student.userId } }), 0);
  // A verification whose amount differs from the attempt is rejected and creates nothing.
  await assert.rejects(payments.completeVerifiedPayment({ ...trustedTestVerifiedPayment(attempt), amount: attempt.amount - 1 }), /amount/i);
  assert.equal(await db.order.count({ where: { userId: student.userId } }), 0);

  const verified = trustedTestVerifiedPayment(attempt);
  const first = await payments.completeVerifiedPayment(verified);
  assert.equal(first.alreadyProcessed, false);
  const order = await db.order.findUniqueOrThrow({ where: { id: first.orderId! }, select: { status: true, total: true, items: { select: { quantity: true, unitPrice: true } } } });
  assert.equal(order.status, "FINDING_RUNNER");
  assert.equal(order.total, attempt.amount);
  assert.deepEqual(order.items, [{ quantity: 2, unitPrice: 300 }]);
  assert.equal(await db.cartItem.count({ where: { cart: { userId: student.userId } } }), 0, "paid quantities leave the cart");

  const again = await payments.completeVerifiedPayment(verified);
  assert.deepEqual(again, { orderId: first.orderId, alreadyProcessed: true });
  // A different provider transaction for the same attempt is refused.
  await assert.rejects(payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt)), /different/i);

  assert.equal(await db.order.count({ where: { userId: student.userId } }), 1);
  const offered = await db.runnerAssignment.findMany({ where: { orderId: first.orderId }, select: { runnerId: true } });
  const offeredIds = new Set(offered.map((a) => a.runnerId));
  for (const runner of eligible) assert.ok(offeredIds.has(runner.runnerId), "eligible runner offered");
  assert.ok(!offeredIds.has(unverified.runnerId) && !offeredIds.has(offline.runnerId), "ineligible runners not offered");
  assert.equal(await db.notification.count({ where: { userId: eligible[0].userId, orderId: first.orderId } }), 1);
});

test("concurrent duplicate payment callbacks create exactly one order and no false reconciliation alert", { skip }, async () => {
  const { db, payments } = app;
  const admin = await createTestUser("ADMIN");
  const { products } = await createTestCatalogue([{ name: "Pure water bag", price: 250 }]);
  // Webhook retries and the student's status polling can finalise the same payment at once.
  for (let round = 0; round < 10; round += 1) {
    const student = await createTestUser("STUDENT");
    const { attempt } = await checkout(student, [{ productId: products[0].id, quantity: 1 }]);
    const verified = trustedTestVerifiedPayment(attempt);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => payments.completeVerifiedPayment(verified)));

    const orders = await db.order.findMany({ where: { userId: student.userId }, select: { id: true } });
    assert.equal(orders.length, 1, `round ${round}: exactly one order`);
    const payment = await db.payment.findUniqueOrThrow({ where: { id: attempt.id }, select: { status: true, orderId: true } });
    assert.deepEqual(payment, { status: "SUCCESS", orderId: orders[0].id }, `round ${round}`);
    assert.equal(
      await db.notification.count({ where: { userId: admin.userId, title: "Payment needs attention" } }),
      0,
      `round ${round}: a successfully completed payment must not raise a reconciliation alert`,
    );
    for (const result of results) {
      assert.equal(result.status, "fulfilled", `round ${round}: duplicate callback should be idempotent, got ${result.status === "rejected" ? (result.reason as { code?: string }).code ?? String(result.reason).slice(0, 80) : ""}`);
      if (result.status === "fulfilled") assert.equal(result.value.orderId, orders[0].id);
    }
  }
});

test("several runners race to accept an order through the API; one wins and only the winner can fulfil it", { skip }, async () => {
  const { db, runnerOrders, runnerMission, runnerMissions, orderApi } = app;
  const student = await createTestUser("STUDENT");
  const otherStudent = await createTestUser("STUDENT");
  const runners = await Promise.all(Array.from({ length: 5 }, () => createTestUser("RUNNER", { isVerified: true, isAvailable: true })));
  const vendorA = await createTestVendor("Mama Put");
  const vendorB = await createTestVendor("Campus mart");
  const { products } = await createTestCatalogue([{ name: "Biro pack", price: 500 }, { name: "Malt", price: 600 }]);
  const orderId = await paidOrder(student, [{ productId: products[0].id, quantity: 2 }, { productId: products[1].id, quantity: 1 }]);

  const results = await Promise.all(runners.map((runner) =>
    asUser(runner, () => callRoute(runnerOrders.POST, { method: "POST", body: { action: "accept" }, params: { id: orderId } }))));
  const winners = results.flatMap((result, index) => result.status === 200 ? [runners[index]] : []);
  assert.equal(winners.length, 1, `exactly one winner: ${JSON.stringify(results.map((r) => [r.status, r.json?.error]))}`);
  for (const result of results.filter((r) => r.status !== 200)) {
    assert.equal(result.status, 409);
    assert.doesNotMatch(String(result.json?.error), /prisma|invocation|\.ts:|tx\./i, "losers never see database internals");
  }
  const winner = winners[0];
  const loser = runners.find((r) => r.runnerId !== winner.runnerId)!;

  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, assignedRunnerId: true } });
  assert.deepEqual(order, { status: "RUNNER_ASSIGNED", assignedRunnerId: winner.runnerId });
  assert.equal(await db.runnerAssignment.count({ where: { orderId, status: "ACCEPTED" } }), 1);
  assert.equal(await db.runnerAssignment.count({ where: { orderId, status: "OFFERED" } }), 0);

  // Repeated accept by the winner does not create another assignment or history entry.
  await asUser(winner, () => callRoute(runnerOrders.POST, { method: "POST", body: { action: "accept" }, params: { id: orderId } }));
  assert.equal(await db.orderStatusHistory.count({ where: { orderId, status: "RUNNER_ASSIGNED" } }), 1);

  // Losers can't see delivery details or act on the order.
  signInAs(loser);
  assert.equal((await callRoute(runnerMission.GET, { params: { id: orderId } })).status, 404);
  const loserList = await callRoute(runnerMissions.GET);
  assert.ok(!JSON.stringify(loserList.json).includes(orderId), "loser no longer sees the mission");
  const items = await db.orderItem.findMany({ where: { orderId }, select: { id: true, productName: true } });
  const biro = items.find((i) => i.productName.startsWith("Biro"))!;
  const malt = items.find((i) => i.productName.startsWith("Malt"))!;
  assert.equal((await callRoute(runnerOrders.POST, { method: "POST", body: { action: "source", orderItemId: biro.id, vendorId: vendorA.id, result: "AVAILABLE", quantity: 2, actualUnitPrice: 500 }, params: { id: orderId } })).status, 409);
  assert.equal((await callRoute(runnerOrders.POST, { method: "POST", body: { action: "delivered" }, params: { id: orderId } })).status, 409);

  // Winner sources from two shops (multi-source), with one unit of biro first, then the rest.
  signInAs(winner);
  const detail = await callRoute(runnerMission.GET, { params: { id: orderId } });
  assert.equal(detail.status, 200);
  assert.ok((detail.json.mission as { deliveryAddress?: string }).deliveryAddress, "assigned runner sees delivery address");
  const source = (body: Record<string, unknown>) => callRoute(runnerOrders.POST, { method: "POST", body: { action: "source", ...body }, params: { id: orderId } });
  assert.equal((await source({ orderItemId: biro.id, vendorId: vendorA.id, result: "AVAILABLE", quantity: 1, actualUnitPrice: 500 })).status, 200);
  assert.equal((await callRoute(runnerOrders.POST, { method: "POST", body: { action: "start-delivery" }, params: { id: orderId } })).status, 409, "delivery can't start while items remain");
  assert.equal((await source({ orderItemId: biro.id, vendorId: vendorB.id, result: "AVAILABLE", quantity: 1, actualUnitPrice: 500 })).status, 200);
  assert.equal((await source({ orderItemId: biro.id, vendorId: vendorB.id, result: "AVAILABLE", quantity: 1, actualUnitPrice: 500 })).status, 409, "can't over-source");

  // A price increase needs the student's decision before delivery.
  const priced = await source({ orderItemId: malt.id, vendorId: vendorB.id, result: "AVAILABLE", quantity: 1, actualUnitPrice: 700 });
  assert.equal(priced.status, 200);
  assert.equal(priced.json.status, "PRICE_PENDING");
  assert.equal((await callRoute(runnerOrders.POST, { method: "POST", body: { action: "start-delivery" }, params: { id: orderId } })).status, 409);
  signInAs(otherStudent);
  assert.equal((await callRoute(orderApi.POST, { method: "POST", body: { action: "price-decision", sourcingId: priced.json.sourcingId, decision: "CONTINUE" }, params: { id: orderId } })).status, 409, "another student can't decide");
  signInAs(student);
  const decided = await callRoute(orderApi.POST, { method: "POST", body: { action: "price-decision", sourcingId: priced.json.sourcingId, decision: "CONTINUE" }, params: { id: orderId } });
  assert.equal(decided.status, 200);

  signInAs(winner);
  assert.equal((await callRoute(runnerOrders.POST, { method: "POST", body: { action: "start-delivery" }, params: { id: orderId } })).status, 200);
  assert.equal((await callRoute(runnerOrders.POST, { method: "POST", body: { action: "delivered" }, params: { id: orderId } })).status, 200);
  const repeat = await callRoute(runnerOrders.POST, { method: "POST", body: { action: "delivered" }, params: { id: orderId } });
  assert.equal(repeat.status, 409, "a second delivered click is refused, not duplicated");
  assert.equal(await db.orderStatusHistory.count({ where: { orderId, status: "DELIVERED" } }), 1);

  signInAs(student);
  const tracked = await callRoute(orderApi.GET, { params: { id: orderId } });
  assert.equal(tracked.status, 200);
  assert.equal((tracked.json.order as { status: string }).status, "DELIVERED");
  signInAs(otherStudent);
  assert.equal((await callRoute(orderApi.GET, { params: { id: orderId } })).status, 404, "students can't read each other's orders");
  const assignment = await db.runnerAssignment.findFirstOrThrow({ where: { orderId, runnerId: winner.runnerId }, select: { status: true } });
  assert.equal(assignment.status, "COMPLETED");
  assert.ok(await db.notification.count({ where: { userId: student.userId, orderId } }) > 0, "student was notified");
});

test("unavailable items move the order to refund processing with a pending (not completed) refund", { skip }, async () => {
  const { db, runnerOrders } = app;
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const vendor = await createTestVendor();
  const { products } = await createTestCatalogue([{ name: "Rare textbook", price: 5_000 }]);
  const orderId = await paidOrder(student, [{ productId: products[0].id, quantity: 1 }]);
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId }, select: { id: true } });

  signInAs(runner);
  assert.equal((await callRoute(runnerOrders.POST, { method: "POST", body: { action: "accept" }, params: { id: orderId } })).status, 200);
  assert.equal((await callRoute(runnerOrders.POST, { method: "POST", body: { action: "source", orderItemId: item.id, vendorId: vendor.id, result: "UNAVAILABLE" }, params: { id: orderId } })).status, 200);
  const result = await callRoute(runnerOrders.POST, { method: "POST", body: { action: "start-delivery" }, params: { id: orderId } });
  assert.equal(result.status, 200);
  assert.equal(result.json.status, "REFUND_PROCESSING");
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, refunds: { select: { status: true, amount: true } } } });
  assert.equal(order.status, "REFUND_PROCESSING");
  assert.deepEqual(order.refunds, [{ status: "PENDING", amount: 5_000 + app.checkoutPricing.CHECKOUT_DELIVERY_FEE }]);
});

test("unclaimed orders time out into refund processing once, and admin-only refund stays protected", { skip }, async () => {
  const { db, scheduled, adminOrders } = app;
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const admin = await createTestUser("ADMIN");
  const { products } = await createTestCatalogue([{ name: "Shawarma", price: 2_500 }]);
  const orderId = await paidOrder(student, [{ productId: products[0].id, quantity: 1 }]);
  await db.order.update({ where: { id: orderId }, data: { findingRunnerAt: new Date(Date.now() - 24 * 60 * 60_000) } });
  // Every eligible runner was offered it at payment time; age those offers past their window too, so the
  // order is past its dispatch deadline with nobody left to try (one expired offer alone never refunds it).
  await db.runnerAssignment.updateMany({ where: { orderId }, data: { offeredAt: new Date(Date.now() - 24 * 60 * 60_000) } });

  await scheduled.expireUnclaimedRunnerOrders();
  await scheduled.expireUnclaimedRunnerOrders();
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, refunds: { select: { status: true } } } });
  assert.equal(order.status, "REFUND_PROCESSING");
  assert.equal(order.refunds.length, 1, "running the scheduler twice creates one refund request");
  assert.equal(await db.runnerAssignment.count({ where: { orderId, status: { in: ["OFFERED", "ACCEPTED"] } } }), 0, "offers are withdrawn");

  signInAs(runner);
  assert.equal((await callRoute(app.runnerOrders.POST, { method: "POST", body: { action: "accept" }, params: { id: orderId } })).status, 409, "an expired order can't be accepted");

  for (const user of [student, runner]) {
    signInAs(user);
    assert.equal((await callRoute(adminOrders.POST, { method: "POST", params: { id: orderId } })).status, 403);
  }
  signInAs(admin);
  assert.equal((await callRoute(adminOrders.POST, { method: "POST", params: { id: orderId } })).status, 200, "admin refund is idempotent on an order already refunding");
  assert.equal(await db.refund.count({ where: { orderId } }), 1);
});

test("a provider success after PackAM marked the payment failed alerts operations without creating an order", { skip }, async () => {
  const { db, payments } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Late payment item", price: 900 }]);
  const { attempt } = await checkout(student, [{ productId: products[0].id, quantity: 1 }]);
  assert.equal(await payments.failPendingPayment(attempt.transactionReference!), true);

  const verified = trustedTestVerifiedPayment(attempt);
  await assert.rejects(payments.completeVerifiedPayment(verified), /no longer pending/i);
  await assert.rejects(payments.completeVerifiedPayment(verified), /no longer pending/i);
  assert.equal(await db.order.count({ where: { userId: student.userId } }), 0, "no order is created automatically");
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: attempt.id }, select: { status: true } })).status, "FAILED");
  assert.equal(await db.notification.count({ where: { userId: admin.userId, title: "Payment succeeded after failure" } }), 1, "operations alerted exactly once");
});

test("a paid order sends the student exactly one order confirmation", { skip }, async () => {
  const { db } = app;
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Plantain chips", price: 400 }]);
  const orderId = await paidOrder(student, [{ productId: products[0].id, quantity: 1 }]);
  const confirmations = await db.notification.findMany({ where: { userId: student.userId, orderId, title: "Order confirmed" }, select: { message: true } });
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0].message, /finding a runner/);
});
