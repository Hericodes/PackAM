/**
 * Admin analytics against a disposable database: every figure is checked against records created here in a
 * quiet window of past dates, admin-only access is enforced, and page-view collection counts each view once
 * while skipping staff, bots, opted-out visitors and staff pages. Run with `npm run test:db`.
 *
 * Amounts and names below are test fixtures only.
 */
import {
  asUser,
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestUser,
  dbTestSkip as skip,
  signInAs,
  testDb,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { campusDayStart } from "./range";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  analytics: typeof import("../../app/api/admin/analytics/route");
  pageview: typeof import("../../app/api/analytics/pageview/route");
};
let app: App;
const visitorPrefix = `test-${randomUUID().slice(0, 8)}`;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [analytics, pageview] = await Promise.all([import("../../app/api/admin/analytics/route"), import("../../app/api/analytics/pageview/route")]);
  app = { db, analytics, pageview };
});
after(async () => {
  if (!skip) await app.db.pageView.deleteMany({ where: { visitorId: { startsWith: visitorPrefix } } });
  await cleanupTestData();
});

const DAY = 24 * 60 * 60 * 1000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** A quiet window in 2024 that no other test writes to. */
const D = addDays("2024-02-01", Math.floor(Math.random() * 270));
const at = (dayOffset: number, hour: number) => new Date(campusDayStart(addDays(D, dayOffset)).getTime() + hour * 60 * 60 * 1000);
const BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

test("analytics figures match the underlying records for a custom range", { skip }, async () => {
  const { db } = app;
  const admin = await createTestUser("ADMIN");
  const [s0, s1, s2, s3] = [await createTestUser("STUDENT"), await createTestUser("STUDENT"), await createTestUser("STUDENT"), await createTestUser("STUDENT")];
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  // Sign-ups: s0 in the previous period, s1–s3 one per day in the window; a runner in the window isn't a customer.
  await db.user.update({ where: { id: s0.userId }, data: { createdAt: at(-1, 9) } });
  for (const [user, day] of [[s1, 0], [s2, 1], [s3, 2]] as const) await db.user.update({ where: { id: user.userId }, data: { createdAt: at(day, 9) } });
  await db.user.update({ where: { id: runner.userId }, data: { createdAt: at(1, 9) } });

  const { products } = await createTestCatalogue([{ name: "Analytics A", price: 500 }, { name: "Analytics B", price: 500 }]);
  const [A, B] = products;
  const order = async (user: string, day: number, status: string, total: number, payment: { status: string; paidDay?: number } | null, items: Array<[typeof A, number]> = []) => {
    const created = at(day, 12);
    const row = await db.order.create({ data: { userId: user, kind: "MARKETPLACE", status: status as never, subtotal: total - 200, deliveryFee: 200, total, deliveryAddress: "Test Hall", createdAt: created } });
    if (payment) await db.payment.create({ data: { userId: user, orderId: row.id, provider: "OPAY", status: payment.status as never, amount: total, transactionReference: `an-${randomUUID()}`, createdAt: created, paidAt: payment.status === "SUCCESS" ? at(payment.paidDay ?? day, 12) : null } });
    for (const [product, quantity] of items) await db.orderItem.create({ data: { orderId: row.id, productId: product.id, productName: product.name, unitPrice: 500, quantity, totalPrice: 500 * quantity } });
    return row;
  };
  await order(s1.userId, 0, "DELIVERED", 1200, { status: "SUCCESS" }, [[A, 2]]);
  await order(s1.userId, 0, "FINDING_RUNNER", 700, { status: "SUCCESS" }, [[B, 1]]);
  await order(s1.userId, 1, "CANCELLED", 900, { status: "SUCCESS" }, [[A, 1]]);
  const refundedOrder = await order(s1.userId, 2, "REFUNDED", 600, { status: "SUCCESS" }, [[B, 1]]);
  await db.refund.create({ data: { orderId: refundedOrder.id, amount: 600, reason: "Test refund", status: "COMPLETED", processedAt: at(2, 15) } });
  await order(s1.userId, 2, "FINDING_RUNNER", 500, { status: "RECONCILIATION_REQUIRED" }); // not confirmed: not paid, not revenue
  await order(s0.userId, -2, "DELIVERED", 1000, { status: "SUCCESS" }); // previous period
  // s2 started a checkout that failed; s3 never checked out.
  await db.payment.create({ data: { userId: s2.userId, provider: "OPAY", status: "FAILED", amount: 700, transactionReference: `an-${randomUUID()}`, createdAt: at(1, 13) } });

  // Printing: one delivered, one refunded (marked in its history), one unpaid draft.
  const printPaid = async (day: number, status: string, amount: number) => {
    const job = await db.printJob.create({ data: { userId: s1.userId, status: status as never, createdAt: at(day, 10), total: amount } });
    await db.payment.create({ data: { userId: s1.userId, printJobId: job.id, provider: "OPAY", status: "SUCCESS", amount, transactionReference: `an-${randomUUID()}`, createdAt: at(day, 10), paidAt: at(day, 10) } });
    return job;
  };
  await printPaid(1, "DELIVERED", 300);
  const refundedJob = await printPaid(2, "REFUNDED", 250);
  await db.printJobStatusHistory.create({ data: { printJobId: refundedJob.id, status: "REFUNDED", createdAt: at(2, 18) } });
  await db.printJob.create({ data: { userId: s1.userId, status: "DRAFT", createdAt: at(2, 11) } });

  // Visitors: A has two sessions (returning), B one; C only in the previous period (so tracking covers both).
  const view = (visitor: string, session: string, path: string, day: number, hour: number, referrerHost: string | null = null) =>
    db.pageView.create({ data: { viewId: randomUUID(), visitorId: `${visitorPrefix}-${visitor}`, sessionId: `${visitorPrefix}-${session}`, path, referrerHost, createdAt: at(day, hour) } });
  await view("C", "c1", "/", -3, 0); // exactly when the previous period starts
  await view("A", "a1", "/", 0, 10, "instagram.com");
  await view("A", "a1", "/search", 0, 10.1);
  await view("A", "a2", "/search", 1, 20);
  await view("B", "b1", "/products/:id", 2, 9);

  const range = { from: D, to: addDays(D, 2) };
  const response = await asUser(admin, () => callRoute(app.analytics.GET, { path: `/api/admin/analytics?from=${range.from}&to=${range.to}` }));
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const data = response.json as unknown as import("./queries").AnalyticsData;

  assert.equal(data.range.bucket, "day");
  assert.equal(data.tracking.coverage, "full");
  const s = data.summary;
  assert.deepEqual([s.pageViews, s.visitors, s.sessions, s.returningVisitors], [4, 2, 3, 1], "visitors");
  assert.equal(s.newUsers, 3, "students who signed up in the window (not the runner)");
  assert.ok(s.totalUsers >= 4, "every student up to the end of the window");
  assert.deepEqual(s.orders, { total: 5, paid: 4, completed: 1, cancelled: 1, refunded: 1 }, "orders");
  assert.equal(s.averageOrderValue, Math.round((1200 + 700 + 900 + 600) / 4));
  assert.equal(s.completionRate, 25);
  assert.equal(s.cancellationRate, 50);
  assert.deepEqual(s.revenue, { captured: 3400 + 550, marketplace: 3400, printing: 550, refunded: 600 + 250, net: 3950 - 850 }, "revenue");
  assert.deepEqual(s.printJobs, { paid: 2, completed: 1 }, "print jobs");

  assert.deepEqual(data.series.orders.map((p) => p.value), [2, 1, 1]);
  assert.deepEqual(data.series.revenue.map((p) => p.value), [1200 + 700, 900 + 300, 600 + 250]);
  assert.deepEqual(data.series.signups.map((p) => p.value), [1, 1, 1]);
  assert.deepEqual(data.series.visitors.map((p) => p.value), [1, 1, 1]);
  assert.deepEqual(data.funnel, { visitors: 2, registered: 3, startedCheckout: 2, purchased: 1 });
  assert.deepEqual(data.landingPages.map((row) => [row.path, row.sessions]).sort(), [["/", 1], ["/products/:id", 1], ["/search", 1]]);
  assert.deepEqual(data.referrers, [{ host: "instagram.com", sessions: 1 }]);
  assert.deepEqual(data.topProducts.map((p) => [p.id, p.units, p.revenue, p.orders]), [[A.id, 2, 1000, 1], [B.id, 1, 500, 1]], "cancelled and refunded orders don't count as sales");
  assert.equal(data.topCategories.length, 1);
  assert.deepEqual([data.topCategories[0].orders, data.topCategories[0].units, data.topCategories[0].revenue], [2, 3, 1500]);
  // Previous period: 1 visitor, 1 paid order of ₦1,000 (net).
  assert.equal(data.changes.visitors, 100);
  assert.equal(data.changes.paidOrders, 300);

  // Nothing personal leaves the server.
  const text = JSON.stringify(data);
  for (const user of [s0, s1, s2, s3]) assert.ok(!text.includes(user.userId));
  assert.ok(!/@packam\.test|Test Hall|an-/.test(text));
});

test("analytics are admin-only and reject invalid ranges", { skip }, async () => {
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  const admin = await createTestUser("ADMIN");
  signInAs(null);
  assert.equal((await callRoute(app.analytics.GET, { path: "/api/admin/analytics?range=7d" })).status, 401);
  for (const user of [student, runner]) assert.equal((await asUser(user, () => callRoute(app.analytics.GET, { path: "/api/admin/analytics?range=7d" }))).status, 403);
  for (const query of ["range=1y", "from=2024-05-10&to=2024-05-01", "from=2099-01-01&to=2099-01-02", "from=2020-01-01&to=2024-01-01", "from=2024-02-30&to=2024-03-01"]) {
    assert.equal((await asUser(admin, () => callRoute(app.analytics.GET, { path: `/api/admin/analytics?${query}` }))).status, 400, query);
  }
  for (const preset of ["today", "7d", "30d", "90d"]) {
    const ok = await asUser(admin, () => callRoute(app.analytics.GET, { path: `/api/admin/analytics?range=${preset}` }));
    assert.equal(ok.status, 200, preset);
    assert.equal((ok.json as { range: { bucket: string } }).range.bucket, preset === "today" ? "hour" : "day");
  }
});

test("page views: one row per view, no duplicates, staff/bots/opted-out/staff pages skipped", { skip }, async () => {
  const { db } = app;
  const student = await createTestUser("STUDENT");
  const admin = await createTestUser("ADMIN");
  const visitorId = `${visitorPrefix}-live`;
  const send = (body: Record<string, unknown>, headers: Record<string, string> = {}) => callRoute(app.pageview.POST, { method: "POST", path: "/api/analytics/pageview", body: { visitorId, sessionId: `${visitorPrefix}-s`, ...body }, headers: { "User-Agent": BROWSER, ...headers } });
  const rows = () => db.pageView.findMany({ where: { visitorId }, select: { path: true, referrerHost: true } });

  signInAs(null);
  const viewId = randomUUID();
  assert.equal((await send({ viewId, path: "/products/cmvrtbyvt00049oqry328fzau?ref=x#top", referrer: "https://www.instagram.com/p/abc" })).status, 204);
  assert.equal((await send({ viewId, path: "/products/cmvrtbyvt00049oqry328fzau" })).status, 204, "a retried send");
  assert.deepEqual(await rows(), [{ path: "/products/:id", referrerHost: "instagram.com" }], "counted once; id, query and fragment dropped");

  await asUser(student, () => send({ viewId: randomUUID(), path: "/search", referrer: "http://packam.test/" }));
  assert.equal((await rows()).length, 2, "signed-in students count; PackAM's own pages aren't a referrer");
  assert.equal((await rows()).find((row) => row.path === "/search")?.referrerHost, null);

  const before = (await rows()).length;
  await asUser(admin, () => send({ viewId: randomUUID(), path: "/search" }));
  signInAs(null);
  await send({ viewId: randomUUID(), path: "/admin/orders" });
  await send({ viewId: randomUUID(), path: "/runner" });
  await send({ viewId: randomUUID(), path: "/" }, { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0 Safari/537.36" });
  await send({ viewId: randomUUID(), path: "/" }, { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" });
  await send({ viewId: randomUUID(), path: "/" }, { DNT: "1" });
  await send({ viewId: randomUUID(), path: "/" }, { "Sec-GPC": "1" });
  assert.equal((await rows()).length, before, "admins, staff pages, bots, headless browsers and opted-out visitors aren't counted");

  for (const bad of [{ viewId: "x", path: "/" }, { viewId: randomUUID(), path: "no-slash" }, { viewId: randomUUID(), path: "/", visitorId: "<script>" }]) {
    assert.equal((await send(bad)).status, 400);
  }
});
