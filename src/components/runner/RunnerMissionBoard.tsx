"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Mission = { id: string; status: string; order: { id: string; status: string; items: { id: string; productName: string; quantity: number }[]; deliveryLocationLabel: string } };

export function RunnerMissionBoard({ adminView = false }: { adminView?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [availability, missionResponse] = await Promise.all([fetch("/api/runner/availability"), fetch("/api/runner/missions")]);
      const a = await availability.json(); const m = await missionResponse.json();
      if (!availability.ok || !missionResponse.ok) throw new Error(a.error || m.error || "Unable to load missions.");
      setAvailable(a.isAvailable); setMissions(m.missions);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load missions."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function toggle() {
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/runner/availability", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ available: !available }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update availability.");
      setAvailable(data.available); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update availability."); setBusy(false); }
  }
  return <>
    <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5">
      <div><p className="font-black">{adminView ? "Operations mission view" : `You’re ${available ? "available for missions" : "offline"}`}</p><p className="mt-1 text-sm text-black/55">{adminView ? "Read-only view. Operational changes stay in the order record." : available ? "New paid orders can be offered to you." : "Go available when you’re ready to deliver."}</p></div>
      {!adminView && <button disabled={busy} onClick={() => void toggle()} className="rounded-full bg-black px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Please wait…" : available ? "Go offline" : "Go available"}</button>}
    </section>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <h2 className="mt-8 text-xl font-black">Missions</h2>
    {busy ? <p className="mt-4 text-sm text-black/50">Loading…</p> : missions.length ? <div className="mt-4 grid gap-3">{missions.map(({ id, status, order }) => <Link key={id} href={adminView ? `/admin/orders/${order.id}` : `/runner/missions/${order.id}`} className="rounded-2xl border border-black/5 bg-white p-5"><strong>{adminView ? `${status === "ACCEPTED" ? "Assigned" : "Offered"} runner mission` : status === "ACCEPTED" ? "Your active delivery" : "New mission"}</strong><p className="mt-2 text-sm text-black/60">{order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ")}</p><p className="mt-2 text-xs text-black/45">{order.deliveryLocationLabel} · {adminView ? "Open order" : "Open mission"} →</p></Link>)}</div> : <p className="mt-3 rounded-2xl bg-white p-5 text-sm text-black/55">{adminView ? "No active missions." : "No missions right now. Keep availability on to receive orders."}</p>}
  </>;
}
