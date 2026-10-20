"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { orderStatusDisplay, printStatusDisplay, runnerOrderNextStep, runnerPrintNextStep } from "../../lib/ops-status";
import { StatusBadge } from "../ui/StatusBadge";

type Mission = { id: string; status: string; order: { id: string; status: string; items: { id: string; productName: string; quantity: number }[]; deliveryLocationLabel: string; deliveryAddress?: string; deliveryInstructions?: string | null } };
type PrintMission = { assignmentId: string; id: string; reference: string; assignmentStatus: string; status: string; colorMode: string | null; sides: string | null; copies: number; selectedPageCount: number | null; deliveryLocationLabel: string };

const REFRESH_MS = 30_000;

// Closest to done first: a runner on the road should see that delivery before anything else.
const URGENCY = ["OUT_FOR_DELIVERY", "PRINTED", "PRINTING", "SOURCING_PRODUCT", "DOCUMENT_RECEIVED", "RUNNER_ASSIGNED"];
const urgency = (status: string) => { const index = URGENCY.indexOf(status); return index === -1 ? URGENCY.length : index; };

function printSummary(mission: PrintMission) {
  const pages = mission.selectedPageCount ?? 0;
  return `${pages} ${pages === 1 ? "page" : "pages"} · ${mission.copies} ${mission.copies === 1 ? "copy" : "copies"} · ${mission.colorMode === "COLOR" ? "Colour" : "B&W"} · ${mission.sides === "DOUBLE" ? "Double-sided" : "Single-sided"} · A4`;
}

type Card = {
  key: string; href: string; kind: "order" | "print"; accepted: boolean; status: string; badge: { label: string; tone: Parameters<typeof StatusBadge>[0]["tone"] };
  title: string; summary: string; location: string; address?: string; instructions?: string | null; nextStep: string | null; cta: string;
};

function MissionCard({ card }: { card: Card }) {
  return <li><Link href={card.href} className={`block rounded-2xl border bg-white p-4 transition hover:border-black/20 sm:p-5 ${card.accepted ? "border-black/10" : "border-[#feb80a]/60 shadow-[0_8px_24px_-18px_rgba(135,90,0,0.7)]"}`}>
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-black">{card.kind === "print" ? "🖨️ Print" : "🛒 Order"}</span>
      <StatusBadge label={card.badge.label} tone={card.badge.tone} />
    </div>
    <p className="mt-2 font-black">{card.title}</p>
    <p className="mt-1 text-sm text-black/70">{card.summary}</p>
    <p className="mt-2 text-sm"><span className="font-bold">📍 {card.location}</span>{card.address && <span className="block text-black/65">{card.address}</span>}{card.instructions && <span className="block text-xs text-black/55">Note: {card.instructions}</span>}</p>
    {card.nextStep && <p className="mt-3 rounded-xl bg-[#fffdf7] px-3 py-2 text-sm"><span className="font-black">Next: </span>{card.nextStep}</p>}
    <span className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-black px-5 text-sm font-black text-white sm:w-auto">{card.cta} →</span>
  </Link></li>;
}

export function RunnerMissionBoard({ adminView = false }: { adminView?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [verified, setVerified] = useState(true);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [printMissions, setPrintMissions] = useState<PrintMission[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const availability = await fetch("/api/runner/availability", { cache: "no-store" });
      const a = await availability.json();
      if (!availability.ok) throw new Error(a.error || "Unable to load your runner status.");
      setAvailable(a.isAvailable);
      setVerified(a.isVerified !== false);
      if (a.isVerified === false) {
        setMissions([]); setPrintMissions([]); setError("");
        return;
      }
      const missionResponse = await fetch("/api/runner/missions", { cache: "no-store" });
      const m = await missionResponse.json();
      if (!missionResponse.ok) throw new Error(m.error || "Unable to load missions.");
      setMissions(m.missions); setPrintMissions(m.printMissions ?? []); setError(""); setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load missions.");
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  // Offers go to every available runner and the first to accept wins, so keep the board fresh.
  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(first); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  async function toggle() {
    setError(""); setToggling(true);
    try {
      const response = await fetch("/api/runner/availability", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ available: !available }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update availability.");
      setAvailable(data.available); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update availability."); }
    finally { setToggling(false); }
  }

  if (loaded && !verified && !adminView) {
    return <section className="mt-6 rounded-2xl bg-white p-5">
      <p className="font-black">Your runner account is awaiting verification</p>
      <p className="mt-1 text-sm text-black/70">PackAM operations will verify you before missions can be offered. Check back soon 🫡</p>
    </section>;
  }

  const cards: Card[] = [
    ...printMissions.map((mission): Card => {
      const accepted = mission.assignmentStatus === "ACCEPTED";
      const display = printStatusDisplay(mission.status);
      return {
        key: `print-${mission.assignmentId}`, kind: "print", accepted, status: mission.status,
        href: adminView ? `/admin/print-jobs/${mission.id}` : `/runner/print-missions/${mission.id}`,
        badge: accepted ? display : { label: "New offer", tone: "warning" },
        title: adminView ? `${accepted ? "Assigned" : "Offered"} · ${mission.reference}` : `${accepted ? "Your print job" : "Print mission"} · ${mission.reference}`,
        summary: printSummary(mission), location: mission.deliveryLocationLabel,
        nextStep: adminView ? null : runnerPrintNextStep(mission.status, mission.assignmentStatus),
        cta: adminView ? "Open print job" : accepted ? "Continue" : "Review & accept",
      };
    }),
    ...missions.map(({ id, status, order }): Card => {
      const accepted = status === "ACCEPTED";
      const display = orderStatusDisplay(order.status);
      return {
        key: `order-${id}`, kind: "order", accepted, status: order.status,
        href: adminView ? `/admin/orders/${order.id}` : `/runner/missions/${order.id}`,
        badge: accepted ? display : { label: "New offer", tone: "warning" },
        title: adminView ? `${accepted ? "Assigned" : "Offered"} runner mission` : accepted ? "Your delivery" : "New mission 🫡",
        summary: order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", "),
        location: order.deliveryLocationLabel, address: order.deliveryAddress, instructions: order.deliveryInstructions,
        nextStep: adminView ? null : runnerOrderNextStep(order.status, status),
        cta: adminView ? "Open order" : accepted ? "Continue" : "Review & accept",
      };
    }),
  ];
  const active = cards.filter((card) => card.accepted).sort((a, b) => urgency(a.status) - urgency(b.status));
  const offers = cards.filter((card) => !card.accepted);

  return <>
    <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5">
      <div className="flex items-start gap-3">
        {!adminView && <span aria-hidden="true" className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${available ? "bg-[#16803c]" : "bg-black/25"}`} />}
        <div><p className="font-black">{adminView ? "Operations mission view" : `You’re ${available ? "available for missions" : "offline"}`}</p><p className="mt-1 text-sm text-black/70">{adminView ? "Read-only view. Operational changes stay in the order record." : available ? "New paid orders and print jobs can be offered to you. This list refreshes on its own." : "Go available when you’re ready to deliver."}</p></div>
      </div>
      {!adminView && <button disabled={toggling || !loaded} onClick={() => void toggle()} className={`min-h-12 w-full rounded-full px-5 text-sm font-black disabled:opacity-50 sm:w-auto ${available ? "border border-black/15 bg-white text-black" : "bg-black text-white"}`}>{toggling ? "Please wait…" : available ? "Go offline" : "Go available"}</button>}
    </section>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-black/55">
      <span role="status" aria-live="polite">{refreshing ? "Refreshing…" : updatedAt ? `Updated ${updatedAt.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}` : ""}</span>
      <button type="button" onClick={() => void load()} disabled={refreshing} className="inline-flex min-h-10 items-center font-bold underline underline-offset-4 disabled:opacity-50">Refresh now</button>
    </div>
    {error && <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 rounded-2xl bg-[#ffe9e7] p-4 text-sm text-[#c92d24]"><span>{error}</span><button type="button" onClick={() => void load()} className="min-h-11 font-bold underline underline-offset-4">Try again</button></div>}

    {!loaded ? <div role="status" aria-label="Loading missions" className="mt-6 grid gap-3">{[0, 1].map((n) => <div key={n} className="h-36 animate-pulse rounded-2xl bg-white motion-reduce:animate-none" />)}</div> : <>
      <section aria-labelledby="active-missions" className="mt-6">
        <h2 id="active-missions" className="flex items-center gap-2 text-xl font-black">{adminView ? "Assigned" : "Your active missions"} <span className="rounded-full bg-black px-2 py-0.5 text-xs text-white">{active.length}</span></h2>
        {active.length ? <ul className="mt-3 grid gap-3 lg:grid-cols-2">{active.map((card) => <MissionCard key={card.key} card={card} />)}</ul>
          : <p className="mt-3 rounded-2xl bg-white p-5 text-sm text-black/65">{adminView ? "No assigned missions." : "Nothing in progress. Accept an offer below and it moves here."}</p>}
      </section>

      <section aria-labelledby="mission-offers" className="mt-8">
        <h2 id="mission-offers" className="flex items-center gap-2 text-xl font-black">{adminView ? "Offered" : "New offers"} <span className={`rounded-full px-2 py-0.5 text-xs ${offers.length ? "bg-[#feb80a] text-black" : "bg-black/10 text-black/60"}`}>{offers.length}</span></h2>
        {!adminView && offers.length > 0 && <p className="mt-1 text-xs text-black/55">Offers go to every available runner — the first to accept gets the mission.</p>}
        {offers.length ? <ul className="mt-3 grid gap-3 lg:grid-cols-2">{offers.map((card) => <MissionCard key={card.key} card={card} />)}</ul>
          : !error && <p className="mt-3 rounded-2xl bg-white p-5 text-sm text-black/65">{adminView ? "No open offers." : available ? "No new missions right now. Stay available — new ones show up here automatically 🛵" : "You’re offline, so no missions will be offered. Go available when you’re ready."}</p>}
      </section>
    </>}
  </>;
}
