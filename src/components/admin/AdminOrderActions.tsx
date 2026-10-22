"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const incidentOptions: Record<string, string[]> = { OPEN: ["OPEN", "INVESTIGATING", "RESOLVED"], INVESTIGATING: ["INVESTIGATING", "RESOLVED", "CLOSED"], RESOLVED: ["RESOLVED", "CLOSED"], CLOSED: ["CLOSED"] };

export function AdminOrderActions({ orderId, incidents, canStartRefund, canRedispatch = false }: { orderId: string; incidents: { id: string; status: string }[]; canStartRefund: boolean; canRedispatch?: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function call(url: string, method: string, body?: unknown) {
    setBusy(true); setMessage("");
    try { const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Action failed."); setMessage("Saved."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Action failed."); }
    finally { setBusy(false); }
  }
  async function updateIncident(id: string, status: string) {
    const resolution = status === "RESOLVED" ? window.prompt("Add a short resolution note") : undefined;
    if (status === "RESOLVED" && !resolution?.trim()) return;
    await call(`/api/admin/incidents/${id}`, "PATCH", { status, ...(resolution ? { resolution } : {}) });
  }
  return <div className="mt-4 flex flex-wrap gap-2">{canRedispatch && <button disabled={busy} onClick={() => { if (window.confirm("Offer this order to every verified, available runner who hasn’t been offered it yet? Expired offers are closed first. No payment changes.")) void call(`/api/admin/orders/${orderId}`, "POST", { action: "redispatch" }); }} className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold disabled:opacity-50">Redispatch to runners</button>}{canStartRefund && <button disabled={busy} onClick={() => { if (window.confirm("Stop fulfilment and start the refund workflow for this order? The provider refund itself must still be completed and confirmed.")) void call(`/api/admin/orders/${orderId}`, "POST"); }} className="rounded-full bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Start refund workflow</button>}{incidents.map((incident) => <select key={incident.id} aria-label={`Incident ${incident.id} status`} disabled={busy || incident.status === "CLOSED"} value={incident.status} onChange={(event) => void updateIncident(incident.id, event.target.value)} className="rounded-full border border-black/10 bg-white px-3 py-2 text-xs">{incidentOptions[incident.status]?.map((status) => <option key={status} value={status}>{status === "OPEN" ? "Incident open" : status.replaceAll("_", " ")}</option>)}</select>)}{message && <p role="status" className="basis-full text-xs text-black/60">{message}</p>}</div>;
}
