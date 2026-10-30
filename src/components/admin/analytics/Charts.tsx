"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Small, dependency-free charts for admin analytics. One series each, in one validated hue (#b77f00: 3:1 or
 * better against the white card); text stays in ink colours. Every chart resizes with its card, has a
 * crosshair tooltip (pointer and arrow keys), and a table view so no value depends on hovering.
 */
export const SERIES = "#b77f00";
const GRID = "#ececec";
const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 26, left: 44 };

export type Point = { bucket: string; value: number | null };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A clean axis maximum and ticks (0 / 5 / 10 …), never fractional for counts. */
function niceTicks(max: number) {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough && Number.isInteger(s)) ?? Math.ceil(rough);
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.0001; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export function compact(value: number) {
  return new Intl.NumberFormat("en-NG", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}
export function naira(value: number, short = false) {
  return `₦${short ? compact(value) : value.toLocaleString("en-NG")}`;
}

/** "2026-03-04" → "4 Mar"; "2026-03-04 13:00" → "13:00". */
export function bucketLabel(bucket: string) {
  if (bucket.length > 10) return bucket.slice(11);
  const [y, m, d] = bucket.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function TrendChart({ title, points, format, axis = compact, emptyNote }: { title: string; points: Point[]; format: (value: number) => string; axis?: (value: number) => string; emptyNote?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const hasData = values.some((v) => v > 0);
  const ticks = niceTicks(Math.max(0, ...values));
  const top = ticks[ticks.length - 1] || 1;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  // Separate runs where values exist: no line is drawn through "no data".
  const runs: Array<Array<[number, number]>> = [];
  points.forEach((p, i) => {
    if (p.value === null) return;
    const last = runs[runs.length - 1];
    if (last && points[i - 1]?.value !== null && i > 0) last.push([x(i), y(p.value)]);
    else runs.push([[x(i), y(p.value)]]);
  });
  const line = (run: Array<[number, number]>) => run.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const area = (run: Array<[number, number]>) => `${line(run)}L${run[run.length - 1][0].toFixed(1)},${y(0).toFixed(1)}L${run[0][0].toFixed(1)},${y(0).toFixed(1)}Z`;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 64))));
  const lastIndex = points.reduce((last, p, i) => (p.value === null ? last : i), -1);

  function pick(clientX: number) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const ratio = (clientX - rect.left - PAD.left) / Math.max(1, plotW);
    setActive(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  }
  const tip = active !== null ? points[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 70), Math.max(70, width - 70)) : 0;

  return (
    <figure className="rounded-2xl bg-white p-4 sm:p-5">
      <figcaption className="text-sm font-black">{title}</figcaption>
      <div
        ref={ref}
        className="relative mt-3 touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-black"
        role="img"
        aria-label={`${title}. Use the table below for every value.`}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          setActive((current) => Math.min(points.length - 1, Math.max(0, (current ?? (e.key === "ArrowLeft" ? points.length : -1)) + (e.key === "ArrowLeft" ? -1 : 1))));
        }}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} aria-hidden="true" className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="rgba(8,8,8,0.55)" style={{ fontVariantNumeric: "tabular-nums" }}>{axis(t)}</text>
              </g>
            ))}
            {points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1) && (i === points.length - 1 || points.length - 1 - i >= labelEvery / 2) ? (
              <text key={p.bucket} x={x(i)} y={HEIGHT - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize="11" fill="rgba(8,8,8,0.55)">{bucketLabel(p.bucket)}</text>
            ) : null)}
            {runs.map((run, i) => <path key={`a${i}`} d={area(run)} fill={SERIES} fillOpacity={0.1} />)}
            {runs.map((run, i) => run.length > 1
              ? <path key={`l${i}`} d={line(run)} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              : <circle key={`l${i}`} cx={run[0][0]} cy={run[0][1]} r={4} fill={SERIES} stroke="#fff" strokeWidth={2} />)}
            {lastIndex >= 0 && points[lastIndex].value !== null && <circle cx={x(lastIndex)} cy={y(points[lastIndex].value!)} r={4} fill={SERIES} stroke="#fff" strokeWidth={2} />}
            {active !== null && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} stroke="rgba(8,8,8,0.35)" strokeWidth={1} />
                {points[active].value !== null && <circle cx={x(active)} cy={y(points[active].value!)} r={5} fill={SERIES} stroke="#fff" strokeWidth={2} />}
              </g>
            )}
          </svg>
        )}
        {tip && (
          <div className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-xl bg-black px-3 py-2 text-white shadow-lg" style={{ left: tipLeft }}>
            <p className="text-sm font-black">{tip.value === null ? "No data" : format(tip.value)}</p>
            <p className="text-[0.6875rem] text-white/70">{bucketLabel(tip.bucket)}{tip.bucket.length > 10 ? ` · ${bucketLabel(tip.bucket.slice(0, 10))}` : ""}</p>
          </div>
        )}
        {!hasData && <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-sm font-semibold text-black/50">{emptyNote ?? "Nothing in this period yet."}</p>}
      </div>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-10 cursor-pointer items-center font-bold text-black/60">Show table</summary>
        <div className="mt-1 max-h-64 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead><tr><th className="py-1 font-bold text-black/50">Period</th><th className="py-1 text-right font-bold text-black/50">Value</th></tr></thead>
            <tbody>{points.map((p) => <tr key={p.bucket} className="border-t border-black/5"><td className="py-1">{p.bucket}</td><td className="py-1 text-right tabular-nums">{p.value === null ? "No data" : format(p.value)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Horizontal bars for ranked lists and the funnel: thin bars, rounded end, value at the tip in ink. */
export function BarList({ rows, format }: { rows: Array<{ label: string; value: number; note?: string }>; format: (value: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words font-semibold">{row.label}</span>
            <span className="shrink-0 font-black">{format(row.value)}{row.note && <span className="ml-1.5 font-semibold text-black/50">{row.note}</span>}</span>
          </div>
          <div className="mt-1.5 h-3 w-full" aria-hidden="true">
            <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(row.value > 0 ? 1 : 0, (row.value / max) * 100)}%`, background: SERIES }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
