"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyticsData } from "../../../lib/analytics/queries";
import { BarList, TrendChart, compact, naira } from "./Charts";

type Selection = { range: string } | { from: string; to: string };
const PRESETS = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]] as const;

function query(selection: Selection) {
  return "range" in selection ? `range=${selection.range}` : `from=${selection.from}&to=${selection.to}`;
}
const fullDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const count = (n: number, one: string, many: string) => `${compact(n)} ${n === 1 ? one : many}`;
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Delta({ value, goodWhenUp = true }: { value: number | null | undefined; goodWhenUp?: boolean }) {
  if (value === null || value === undefined) return null;
  const up = value > 0;
  const good = value === 0 ? null : up === goodWhenUp;
  return (
    <span className={`text-xs font-bold ${good === null ? "text-black/50" : good ? "text-[#16803c]" : "text-[#c92d24]"}`}>
      <span aria-hidden="true">{value > 0 ? "▲" : value < 0 ? "▼" : "•"} </span>
      {value > 0 ? "+" : ""}{value}%<span className="sr-only"> versus the previous period</span>
    </span>
  );
}

function Tile({ label, value, hint, delta, goodWhenUp, className = "" }: { label: string; value: string; hint?: string; delta?: number | null; goodWhenUp?: boolean; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl bg-white p-4 ${className}`}>
      <h3 className="text-xs font-bold text-black/55">{label}</h3>
      {/* Numbers never break mid-way (the admin area otherwise wraps anywhere, for long reference ids). */}
      <p className="mt-1 text-2xl font-black leading-tight [overflow-wrap:normal] sm:text-3xl">{value}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Delta value={delta} goodWhenUp={goodWhenUp} />
        {hint && <span className="text-[0.6875rem] leading-4 text-black/50">{hint}</span>}
      </p>
    </section>
  );
}

function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="min-w-0 rounded-2xl bg-white p-4 sm:p-5">
      <h3 className="text-sm font-black">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-black/50">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AnalyticsDashboard({ initial, today }: { initial: Selection; today: string }) {
  const [selection, setSelection] = useState<Selection>(initial);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState(() => ("from" in initial ? initial : { from: "", to: today }));
  const request = useRef(0);

  const load = useCallback(async (next: Selection) => {
    const ticket = ++request.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/analytics?${query(next)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (ticket !== request.current) return;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Analytics couldn’t load. Try again.");
      setData(body as AnalyticsData);
      window.history.replaceState(null, "", `/admin/analytics?${query(next)}`);
    } catch (caught) {
      if (ticket === request.current) setError(caught instanceof Error ? caught.message : "Analytics couldn’t load. Try again.");
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, []);

  // First load once mounted; afterwards every change of range loads straight from the control that changed it.
  const initialRef = useRef(initial);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(initialRef.current); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const choose = (next: Selection) => { setSelection(next); void load(next); };

  const s = data?.summary;
  const c = data?.changes;
  const tracked = data?.tracking.coverage !== "none";
  const period = data ? (data.range.key === "today" ? "yesterday" : "the previous period") : "";
  const visitorValue = (n: number) => (tracked ? compact(n) : "—");

  return (
    <div>
      {/* Filters: one row above everything they scope. */}
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Date range">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={"range" in selection && selection.range === key} onClick={() => choose({ range: key })} className={`min-h-10 rounded-full px-4 text-sm font-bold ${"range" in selection && selection.range === key ? "bg-black text-white" : "bg-white ring-1 ring-black/10 hover:ring-black/30"}`}>{label}</button>
          ))}
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (custom.from && custom.to) choose({ from: custom.from, to: custom.to }); }}
        >
          <label className="text-xs font-bold text-black/55">From
            <input type="date" required max={today} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="pk-input mt-1 block min-h-10 w-[9.5rem]" />
          </label>
          <label className="text-xs font-bold text-black/55">To
            <input type="date" required max={today} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="pk-input mt-1 block min-h-10 w-[9.5rem]" />
          </label>
          <button type="submit" aria-pressed={"from" in selection} className={`min-h-10 rounded-full px-4 text-sm font-bold ${"from" in selection ? "bg-black text-white" : "bg-white ring-1 ring-black/10 hover:ring-black/30"}`}>Apply dates</button>
        </form>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#ffe9e7] p-4 text-sm font-semibold text-[#8f1d16]">
          <span>{error}</span>
          <button type="button" onClick={() => void load(selection)} className="min-h-10 rounded-full bg-black px-4 font-bold text-white">Try again</button>
        </div>
      )}

      {!data && loading && <p role="status" className="mt-6 rounded-2xl bg-white p-6 text-sm font-semibold text-black/55">Loading analytics…</p>}

      {data && s && c && (
        <div className={`transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <p className="mt-4 text-sm text-black/60">
            <strong className="text-black">{data.range.label}</strong> · {data.range.fromDay === data.range.toDay ? shortDay(data.range.fromDay) : `${shortDay(data.range.fromDay)} – ${shortDay(data.range.toDay)}`} · changes compare with {period} · updated {new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}
          </p>

          <p className={`mt-3 rounded-2xl p-3 text-sm ${data.tracking.coverage === "full" ? "bg-white text-black/60" : "bg-[#fff3d6] font-semibold text-[#7a4600]"}`}>
            {data.tracking.startedAt
              ? data.tracking.coverage === "full"
                ? `Visitor tracking has been on since ${fullDate(data.tracking.startedAt)}.`
                : data.tracking.coverage === "partial"
                  ? `Visitor tracking started on ${fullDate(data.tracking.startedAt)}, during this period. Visitors before then weren’t recorded, so visitor numbers here are incomplete.`
                  : `Visitor tracking started on ${fullDate(data.tracking.startedAt)}, after this period. No visitor data exists for it.`
              : "Visitor tracking is on, but no visits have been recorded yet. Orders, sign-ups and revenue come from PackAM’s records and are complete."}
          </p>

          <h2 className="mt-6 text-lg font-black">Overview</h2>
          {/* Two columns on any phone (values are compact, so they fit); one only on very narrow screens. */}
          <div className="mt-3 grid grid-cols-1 gap-3 min-[340px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            <Tile label="Unique visitors" value={visitorValue(s.visitors)} delta={c.visitors} hint={tracked ? `${compact(s.returningVisitors)} returning` : "Not recorded"} />
            <Tile label="Total visits (page views)" value={visitorValue(s.pageViews)} delta={c.pageViews} hint={tracked ? count(s.sessions, "session", "sessions") : "Not recorded"} />
            <Tile label="New customers" value={compact(s.newUsers)} delta={c.newUsers} hint="Student sign-ups" />
            <Tile label="Total customers" value={compact(s.totalUsers)} hint="All students by the end of the period" />
            <Tile label="Marketplace orders" value={compact(s.orders.total)} delta={c.orders} hint="Food and shop orders" />
            <Tile label="Paid orders" value={compact(s.orders.paid)} delta={c.paidOrders} hint="Payment confirmed by provider" />
            <Tile label="Completed orders" value={compact(s.orders.completed)} hint="Delivered" />
            <Tile label="Cancelled orders" value={compact(s.orders.cancelled + s.orders.refunded)} hint={`Includes ${s.orders.refunded} refunded`} />
            <Tile label="Confirmed revenue" value={naira(s.revenue.net, true)} delta={c.revenue} hint={`${naira(s.revenue.captured, true)} paid − ${naira(s.revenue.refunded, true)} refunded`} />
            <Tile label="Print jobs" value={compact(s.printJobs.paid)} delta={c.printJobs} hint="Paid print jobs" />
            <Tile label="Completed print jobs" value={compact(s.printJobs.completed)} hint="Delivered" />
          </div>

          {/* Phones: order value across the top, the two rates side by side; one row of three from tablet width. */}
          <div className="mt-3 grid grid-cols-1 gap-3 min-[340px]:grid-cols-2 sm:grid-cols-3">
            <Tile label="Average order value" value={s.averageOrderValue === null ? "—" : naira(s.averageOrderValue, true)} hint="Paid marketplace orders" className="min-[340px]:col-span-2 sm:col-span-1" />
            <Tile label="Completion rate" value={s.completionRate === null ? "—" : `${s.completionRate}%`} hint="Delivered ÷ paid" />
            <Tile label="Cancellation rate" value={s.cancellationRate === null ? "—" : `${s.cancellationRate}%`} hint="Cancelled or refunded ÷ paid" />
          </div>

          <h2 className="mt-8 text-lg font-black">Over time</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <TrendChart title={`Visitors per ${data.range.bucket}`} points={data.series.visitors} format={(v) => `${v.toLocaleString("en-NG")} ${v === 1 ? "visitor" : "visitors"}`} emptyNote={tracked ? "No visits in this period." : "No visitor data for this period."} />
            <TrendChart title={`New customers per ${data.range.bucket}`} points={data.series.signups} format={(v) => `${v.toLocaleString("en-NG")} ${v === 1 ? "sign-up" : "sign-ups"}`} />
            <TrendChart title={`Paid orders per ${data.range.bucket}`} points={data.series.orders} format={(v) => `${v.toLocaleString("en-NG")} ${v === 1 ? "order" : "orders"}`} />
            <TrendChart title={`Payments received per ${data.range.bucket}`} points={data.series.revenue} format={(v) => naira(v)} axis={(v) => naira(v, true)} />
          </div>

          <h2 className="mt-8 text-lg font-black">Customers</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Panel title="Conversion funnel" note="Visitors in this period, then the customers who signed up in it, how many of them started a checkout, and how many paid.">
              <BarList
                format={(v) => compact(v)}
                rows={[
                  ...(data.funnel.visitors === null ? [] : [{ label: "Visitors", value: data.funnel.visitors }]),
                  { label: "Signed up", value: data.funnel.registered },
                  { label: "Started a checkout", value: data.funnel.startedCheckout, note: data.funnel.registered ? `${Math.round((data.funnel.startedCheckout / data.funnel.registered) * 100)}%` : undefined },
                  { label: "Paid for an order", value: data.funnel.purchased, note: data.funnel.registered ? `${Math.round((data.funnel.purchased / data.funnel.registered) * 100)}%` : undefined },
                ]}
              />
              {data.funnel.visitors === null && <p className="mt-3 text-xs text-black/50">Visitors aren’t shown: there’s no visitor data for this period.</p>}
            </Panel>
            <Panel title="Where visits start" note="The first page of each visit, and the sites that sent visitors.">
              {data.landingPages.length ? <BarList format={(v) => count(v, "visit", "visits")} rows={data.landingPages.map((row) => ({ label: row.path, value: row.sessions }))} /> : <p className="text-sm text-black/50">{tracked ? "No visits in this period." : "No visitor data for this period."}</p>}
              {data.referrers.length > 0 && (
                <div className="mt-5 border-t border-black/5 pt-4">
                  <h4 className="text-xs font-bold text-black/55">Referring sites</h4>
                  <div className="mt-3"><BarList format={(v) => count(v, "visit", "visits")} rows={data.referrers.map((row) => ({ label: row.host, value: row.sessions }))} /></div>
                </div>
              )}
            </Panel>
          </div>

          <h2 className="mt-8 text-lg font-black">Products</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Panel title="Top-selling products" note="Units in paid marketplace orders that weren’t cancelled or refunded.">
              {data.topProducts.length ? <BarList format={(v) => `${compact(v)} sold`} rows={data.topProducts.map((p) => ({ label: p.name, value: p.units, note: naira(p.revenue, true) }))} /> : <p className="text-sm text-black/50">No sales in this period.</p>}
            </Panel>
            <Panel title="Most ordered categories" note="Orders containing each category (a product’s current category).">
              {data.topCategories.length ? <BarList format={(v) => count(v, "order", "orders")} rows={data.topCategories.map((cat) => ({ label: cat.name, value: cat.orders, note: naira(cat.revenue, true) }))} /> : <p className="text-sm text-black/50">No sales in this period.</p>}
            </Panel>
          </div>

          <details className="mt-8 rounded-2xl bg-white p-4 text-sm sm:p-5">
            <summary className="inline-flex min-h-10 cursor-pointer items-center font-black">How these numbers are worked out</summary>
            <dl className="mt-3 grid gap-3 text-black/70 md:grid-cols-2">
              <div><dt className="font-bold text-black">Visitors, visits, sessions</dt><dd>Anonymous page views from this site, counted from when tracking started. A visitor is one browser; a session ends after 30 minutes without a page view; returning = more than one session. Staff, admin and runner pages, bots and visitors with Do Not Track are not counted.</dd></div>
              <div><dt className="font-bold text-black">Customers</dt><dd>Student accounts, by sign-up date. Runner and admin accounts are not customers.</dd></div>
              <div><dt className="font-bold text-black">Orders</dt><dd>Marketplace (shop and food) orders by the time they were placed. Paid = payment confirmed by the provider. Completed = delivered. Cancelled includes failed and refunded orders. Print jobs are counted separately.</dd></div>
              <div><dt className="font-bold text-black">Revenue</dt><dd>Payments confirmed by the provider, by the time they were paid, minus completed refunds. Pending, failed and payments under reconciliation are never counted. Includes delivery fees.</dd></div>
              <div><dt className="font-bold text-black">Print jobs</dt><dd>Print jobs with a confirmed payment, by the time they were created. Completed = delivered.</dd></div>
              <div><dt className="font-bold text-black">Rates and comparisons</dt><dd>Rates use paid orders as the base. Changes compare with the same length of time just before; visitor changes only show once tracking covers both periods.</dd></div>
            </dl>
          </details>
        </div>
      )}
    </div>
  );
}
