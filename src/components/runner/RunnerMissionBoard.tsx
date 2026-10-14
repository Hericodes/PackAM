"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Mission = { id: string; status: string; order: { id: string; status: string; items: { id: string; productName: string; quantity: number }[]; deliveryLocationLabel: string } };
type PrintMission = { assignmentId: string; id: string; reference: string; assignmentStatus: string; status: string; colorMode: string | null; sides: string | null; copies: number; selectedPageCount: number | null; deliveryLocationLabel: string };

const REFRESH_MS = 30_000;

function printSummary(mission: PrintMission) {
  const pages = mission.selectedPageCount ?? 0;
  return `${pages} ${pages === 1 ? "page" : "pages"} · ${mission.copies} ${mission.copies === 1 ? "copy" : "copies"} · ${mission.colorMode === "COLOR" ? "Colour" : "B&W"} · ${mission.sides === "DOUBLE" ? "Double-sided" : "Single-sided"} · A4`;
}

export function RunnerMissionBoard({ adminView = false }: { adminView?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [verified, setVerified] = useState(true);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [printMissions, setPrintMissions] = useState<PrintMission[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
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
      setMissions(m.missions); setPrintMissions(m.printMissions ?? []); setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load missions.");
    } finally {
      setLoaded(true);
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

  const empty = !missions.length && !printMissions.length;
  return <>
    <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5">
      <div><p className="font-black">{adminView ? "Operations mission view" : `You’re ${available ? "available for missions" : "offline"}`}</p><p className="mt-1 text-sm text-black/70">{adminView ? "Read-only view. Operational changes stay in the order record." : available ? "New paid orders and print jobs can be offered to you. This list refreshes on its own." : "Go available when you’re ready to deliver."}</p></div>
      {!adminView && <button disabled={toggling || !loaded} onClick={() => void toggle()} className="min-h-11 rounded-full bg-black px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{toggling ? "Please wait…" : available ? "Go offline" : "Go available"}</button>}
    </section>
    {error && <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => void load()} className="min-h-11 font-bold underline underline-offset-4">Try again</button></div>}
    <h2 className="mt-8 text-xl font-black">Missions</h2>
    {!loaded ? <p role="status" className="mt-4 text-sm text-black/70">Loading missions…</p> : <>
      {printMissions.length > 0 && <div className="mt-4 grid gap-3">{printMissions.map((mission) => <Link key={mission.assignmentId} href={adminView ? `/admin/print-jobs/${mission.id}` : `/runner/print-missions/${mission.id}`} className="rounded-2xl border border-black/5 bg-white p-5"><span className="inline-flex rounded-full bg-[#fff3bf] px-2.5 py-1 text-xs font-black">🖨️ Print mission</span><strong className="mt-2 block">{adminView ? `${mission.assignmentStatus === "OFFERED" ? "Offered" : "Assigned"} · ${mission.reference}` : mission.assignmentStatus === "ACCEPTED" ? `Your print job · ${mission.reference}` : `New print mission · ${mission.reference}`}</strong><p className="mt-2 text-sm text-black/70">{printSummary(mission)}</p><p className="mt-2 text-xs text-black/60">{mission.deliveryLocationLabel} · {mission.status.replaceAll("_", " ").toLowerCase()} · {adminView ? "Open print job" : "Open mission"} →</p></Link>)}</div>}
      {missions.length > 0 && <div className="mt-4 grid gap-3">{missions.map(({ id, status, order }) => <Link key={id} href={adminView ? `/admin/orders/${order.id}` : `/runner/missions/${order.id}`} className="rounded-2xl border border-black/5 bg-white p-5"><strong>{adminView ? `${status === "ACCEPTED" ? "Assigned" : "Offered"} runner mission` : status === "ACCEPTED" ? "Your active delivery" : "New mission 🫡"}</strong><p className="mt-2 text-sm text-black/70">{order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ")}</p><p className="mt-2 text-xs text-black/60">{order.deliveryLocationLabel} · {adminView ? "Open order" : "Open mission"} →</p></Link>)}</div>}
      {empty && !error && <p className="mt-3 rounded-2xl bg-white p-5 text-sm text-black/70">{adminView ? "No active missions." : available ? "No missions right now. Stay available — new ones show up here automatically." : "You’re offline, so no missions will be offered. Go available when you’re ready."}</p>}
    </>}
  </>;
}
