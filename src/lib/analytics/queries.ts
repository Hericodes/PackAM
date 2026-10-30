import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { campusDay, change, fillSeries, rate, type AnalyticsRange } from "./range";

/*
 * Admin analytics, computed in the database from the records PackAM already keeps. Definitions (also shown
 * on the page):
 *
 * - Customers: users with the STUDENT role (runner and admin accounts are staff).
 * - Marketplace orders: orders of kind MARKETPLACE, by the time they were created. An order only exists after
 *   its payment was verified, so "paid" = its payment is SUCCESS (or later REFUNDED); a payment still under
 *   reconciliation is not counted as paid.
 * - Completed = DELIVERED. Cancelled = CANCELLED or FAILED. Refunded = REFUND_PROCESSING or REFUNDED.
 * - Revenue: payments confirmed by the provider (SUCCESS, or REFUNDED after capture), by the time they were
 *   paid; marketplace and printing split by what was paid for. Refunds: completed marketplace refunds (by
 *   when processed) and print jobs marked REFUNDED (by when marked). Net = captured − refunded. Pending,
 *   failed and under-reconciliation payments are never revenue.
 * - Print jobs: jobs with a confirmed payment, by when created; completed = DELIVERED. Never mixed with orders.
 * - Visitors: anonymous page views (see lib/analytics/tracking.ts), counted only since tracking started.
 */

const CAPTURED = Prisma.sql`('SUCCESS', 'REFUNDED')`;
const CLOSED_ORDER = Prisma.sql`('CANCELLED', 'FAILED', 'REFUND_PROCESSING', 'REFUNDED')`;

/** A JS instant as a UTC timestamp, matching how Prisma stores DateTime (independent of the server's zone). */
const ts = (at: Date) => Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const between = (column: Prisma.Sql, from: Date, to: Date) => Prisma.sql`${column} >= ${ts(from)} AND ${column} < ${ts(to)}`;
/** The campus-time bucket label of a stored timestamp. */
const bucketOf = (column: Prisma.Sql, bucket: "hour" | "day") =>
  Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos', ${bucket === "hour" ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD"})`;

const num = (value: unknown) => (typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : value == null ? 0 : Number(value));

async function series(sql: Prisma.Sql, range: AnalyticsRange) {
  const rows = await db.$queryRaw<Array<{ bucket: string; value: unknown }>>(sql);
  return fillSeries(range, rows.map((row) => ({ bucket: row.bucket, value: num(row.value) })));
}

/** The headline numbers for one period (also run for the previous period, for comparisons). */
async function summary(from: Date, to: Date) {
  const [visitors, newUsers, totalUsers, orders, revenue, refunds, printJobs] = await Promise.all([
    db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT count(*) AS page_views, count(DISTINCT "visitorId") AS visitors, count(DISTINCT "sessionId") AS sessions
      FROM "PageView" WHERE ${between(Prisma.sql`"createdAt"`, from, to)}`),
    db.user.count({ where: { role: "STUDENT", createdAt: { gte: from, lt: to } } }),
    db.user.count({ where: { role: "STUDENT", createdAt: { lt: to } } }),
    db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT count(*) AS total,
        count(*) FILTER (WHERE p.status IN ${CAPTURED}) AS paid,
        count(*) FILTER (WHERE p.status IN ${CAPTURED} AND o.status = 'DELIVERED') AS completed,
        count(*) FILTER (WHERE p.status IN ${CAPTURED} AND o.status IN ('CANCELLED', 'FAILED')) AS cancelled,
        count(*) FILTER (WHERE p.status IN ${CAPTURED} AND o.status IN ('REFUND_PROCESSING', 'REFUNDED')) AS refunded,
        coalesce(sum(o.total) FILTER (WHERE p.status IN ${CAPTURED}), 0) AS paid_value
      FROM "Order" o LEFT JOIN "Payment" p ON p."orderId" = o.id
      WHERE o.kind = 'MARKETPLACE' AND ${between(Prisma.sql`o."createdAt"`, from, to)}`),
    db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT coalesce(sum(amount), 0) AS captured,
        coalesce(sum(amount) FILTER (WHERE "printJobId" IS NOT NULL), 0) AS printing,
        coalesce(sum(amount) FILTER (WHERE "printJobId" IS NULL), 0) AS marketplace
      FROM "Payment" WHERE status IN ${CAPTURED} AND ${between(Prisma.sql`"paidAt"`, from, to)}`),
    db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT
        (SELECT coalesce(sum(amount), 0) FROM "Refund" WHERE status = 'COMPLETED' AND ${between(Prisma.sql`"processedAt"`, from, to)}) AS marketplace,
        (SELECT coalesce(sum(p.amount), 0) FROM "Payment" p
          JOIN (SELECT "printJobId", min("createdAt") AS at FROM "PrintJobStatusHistory" WHERE status = 'REFUNDED' GROUP BY "printJobId") h ON h."printJobId" = p."printJobId"
          WHERE p.status IN ${CAPTURED} AND ${between(Prisma.sql`h.at`, from, to)}) AS printing`),
    db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT count(*) AS paid, count(*) FILTER (WHERE j.status = 'DELIVERED') AS completed
      FROM "PrintJob" j
      WHERE ${between(Prisma.sql`j."createdAt"`, from, to)}
        AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."printJobId" = j.id AND p.status IN ${CAPTURED})`),
  ]);
  const v = visitors[0]; const o = orders[0]; const r = revenue[0]; const f = refunds[0]; const pj = printJobs[0];
  const paid = num(o.paid);
  const refunded = num(f.marketplace) + num(f.printing);
  return {
    pageViews: num(v.page_views), visitors: num(v.visitors), sessions: num(v.sessions),
    newUsers, totalUsers,
    orders: { total: num(o.total), paid, completed: num(o.completed), cancelled: num(o.cancelled), refunded: num(o.refunded) },
    averageOrderValue: paid ? Math.round(num(o.paid_value) / paid) : null,
    completionRate: rate(num(o.completed), paid),
    cancellationRate: rate(num(o.cancelled) + num(o.refunded), paid),
    revenue: { captured: num(r.captured), marketplace: num(r.marketplace), printing: num(r.printing), refunded, net: num(r.captured) - refunded },
    printJobs: { paid: num(pj.paid), completed: num(pj.completed) },
  };
}

export type AnalyticsSummary = Awaited<ReturnType<typeof summary>>;

export async function loadAnalytics(range: AnalyticsRange) {
  const { from, to } = range;
  const [current, previous, tracking, returning, visitorSeries, signupSeries, orderSeries, revenueSeries, funnel, landing, referrers, topProducts, topCategories] = await Promise.all([
    summary(from, to),
    summary(range.previousFrom, range.previousTo),
    db.pageView.aggregate({ _min: { createdAt: true } }),
    // Returning: a visitor seen in this period who has had more than one session up to its end.
    db.$queryRaw<Array<{ n: unknown }>>(Prisma.sql`
      SELECT count(*) AS n FROM (
        SELECT "visitorId" FROM "PageView" WHERE "createdAt" < ${ts(to)}
        GROUP BY "visitorId" HAVING count(DISTINCT "sessionId") > 1 AND max("createdAt") >= ${ts(from)}
      ) t`),
    series(Prisma.sql`SELECT ${bucketOf(Prisma.sql`"createdAt"`, range.bucket)} AS bucket, count(DISTINCT "visitorId") AS value FROM "PageView" WHERE ${between(Prisma.sql`"createdAt"`, from, to)} GROUP BY 1`, range),
    series(Prisma.sql`SELECT ${bucketOf(Prisma.sql`"createdAt"`, range.bucket)} AS bucket, count(*) AS value FROM "User" WHERE role = 'STUDENT' AND ${between(Prisma.sql`"createdAt"`, from, to)} GROUP BY 1`, range),
    series(Prisma.sql`SELECT ${bucketOf(Prisma.sql`o."createdAt"`, range.bucket)} AS bucket, count(*) AS value FROM "Order" o JOIN "Payment" p ON p."orderId" = o.id WHERE o.kind = 'MARKETPLACE' AND p.status IN ${CAPTURED} AND ${between(Prisma.sql`o."createdAt"`, from, to)} GROUP BY 1`, range),
    series(Prisma.sql`SELECT ${bucketOf(Prisma.sql`"paidAt"`, range.bucket)} AS bucket, sum(amount) AS value FROM "Payment" WHERE status IN ${CAPTURED} AND ${between(Prisma.sql`"paidAt"`, from, to)} GROUP BY 1`, range),
    // Of the customers who signed up in this period: how many started a checkout, and how many paid.
    db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT count(*) AS registered,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Payment" p WHERE p."userId" = u.id AND p."createdAt" < ${ts(to)})) AS started,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Payment" p WHERE p."userId" = u.id AND p.status IN ${CAPTURED} AND p."paidAt" < ${ts(to)})) AS purchased
      FROM "User" u WHERE u.role = 'STUDENT' AND ${between(Prisma.sql`u."createdAt"`, from, to)}`),
    // The first page of each session that began in this period.
    db.$queryRaw<Array<{ path: string; sessions: unknown }>>(Prisma.sql`
      SELECT path, count(*) AS sessions FROM (
        SELECT DISTINCT ON ("sessionId") "sessionId", path, "createdAt" FROM "PageView" WHERE "createdAt" < ${ts(to)} ORDER BY "sessionId", "createdAt"
      ) first WHERE ${between(Prisma.sql`first."createdAt"`, from, to)} GROUP BY path ORDER BY count(*) DESC, path LIMIT 8`),
    db.$queryRaw<Array<{ host: string; sessions: unknown }>>(Prisma.sql`
      SELECT "referrerHost" AS host, count(DISTINCT "sessionId") AS sessions FROM "PageView"
      WHERE "referrerHost" IS NOT NULL AND ${between(Prisma.sql`"createdAt"`, from, to)} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 6`),
    // Products and categories from paid marketplace orders that weren't cancelled or refunded.
    db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT oi."productId" AS id, max(oi."productName") AS name, sum(oi.quantity) AS units, sum(oi."totalPrice") AS revenue, count(DISTINCT o.id) AS orders
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" JOIN "Payment" p ON p."orderId" = o.id
      WHERE o.kind = 'MARKETPLACE' AND p.status IN ${CAPTURED} AND o.status NOT IN ${CLOSED_ORDER} AND ${between(Prisma.sql`o."createdAt"`, from, to)}
      GROUP BY oi."productId" ORDER BY units DESC, revenue DESC LIMIT 10`),
    db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT c.name AS name, sum(oi.quantity) AS units, sum(oi."totalPrice") AS revenue, count(DISTINCT o.id) AS orders
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" JOIN "Payment" p ON p."orderId" = o.id
        JOIN "Product" pr ON pr.id = oi."productId" JOIN "Category" c ON c.id = pr."categoryId"
      WHERE o.kind = 'MARKETPLACE' AND p.status IN ${CAPTURED} AND o.status NOT IN ${CLOSED_ORDER} AND ${between(Prisma.sql`o."createdAt"`, from, to)}
      GROUP BY c.id, c.name ORDER BY orders DESC, units DESC LIMIT 8`),
  ]);

  // Visitor numbers only exist from the first recorded page view; earlier buckets are "no data", not zero.
  const trackingStartedAt = tracking._min.createdAt;
  const trackedFrom = (bucket: string) => {
    if (!trackingStartedAt) return false;
    const startDay = campusDay(trackingStartedAt);
    if (range.bucket === "day") return bucket >= startDay;
    const startHour = new Date(trackingStartedAt.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13).replace("T", " ") + ":00";
    return bucket >= startHour;
  };
  const coverage = !trackingStartedAt ? "none" : trackingStartedAt <= from ? "full" : trackingStartedAt < to ? "partial" : "none";
  const visitorsComparable = Boolean(trackingStartedAt && trackingStartedAt <= range.previousFrom);
  const f = funnel[0];

  return {
    range: { key: range.key, label: range.label, fromDay: range.fromDay, toDay: range.toDay, bucket: range.bucket },
    tracking: { startedAt: trackingStartedAt?.toISOString() ?? null, coverage },
    summary: { ...current, returningVisitors: num(returning[0]?.n) },
    changes: {
      visitors: change(current.visitors, previous.visitors, visitorsComparable),
      pageViews: change(current.pageViews, previous.pageViews, visitorsComparable),
      newUsers: change(current.newUsers, previous.newUsers),
      orders: change(current.orders.total, previous.orders.total),
      paidOrders: change(current.orders.paid, previous.orders.paid),
      revenue: change(current.revenue.net, previous.revenue.net),
      printJobs: change(current.printJobs.paid, previous.printJobs.paid),
    },
    series: {
      visitors: visitorSeries.map((point) => ({ bucket: point.bucket, value: trackedFrom(point.bucket) ? point.value : null })),
      signups: signupSeries,
      orders: orderSeries,
      revenue: revenueSeries,
    },
    funnel: { visitors: coverage === "none" ? null : current.visitors, registered: num(f.registered), startedCheckout: num(f.started), purchased: num(f.purchased) },
    landingPages: landing.map((row) => ({ path: row.path, sessions: num(row.sessions) })),
    referrers: referrers.map((row) => ({ host: row.host, sessions: num(row.sessions) })),
    topProducts: topProducts.map((row) => ({ id: String(row.id), name: String(row.name), units: num(row.units), revenue: num(row.revenue), orders: num(row.orders) })),
    topCategories: topCategories.map((row) => ({ name: String(row.name), units: num(row.units), revenue: num(row.revenue), orders: num(row.orders) })),
    generatedAt: new Date().toISOString(),
  };
}

export type AnalyticsData = Awaited<ReturnType<typeof loadAnalytics>>;
