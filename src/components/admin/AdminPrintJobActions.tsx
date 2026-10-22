"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminPrintJobActions({ printJobId, canRetry, canRefund, canCancelUnpaid = false, canRedispatch = false }: { printJobId: string; canRetry: boolean; canRefund: boolean; canCancelUnpaid?: boolean; canRedispatch?: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function call(action: "retry" | "refund" | "cancel-unpaid" | "redispatch") {
    if (action === "refund" && !window.confirm("Stop fulfilment and move this print job to refund processing? The OPay refund itself must be completed manually.")) return;
    if (action === "cancel-unpaid" && !window.confirm("Cancel this unpaid print job? Any pending payment is checked with OPay first; a paid or uncertain payment blocks cancelling.")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/print-jobs/${encodeURIComponent(printJobId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Action failed.");
      setMessage("Saved."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed."); }
    finally { setBusy(false); }
  }
  if (!canRetry && !canRefund && !canCancelUnpaid && !canRedispatch) return null;
  return <div className="mt-4 flex flex-wrap items-center gap-2">
    {canRedispatch && <button disabled={busy} onClick={() => void call("redispatch")} className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold disabled:opacity-50">Redispatch to runners</button>}
    {canRetry && <button disabled={busy} onClick={() => void call("retry")} className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold disabled:opacity-50">Send back to runner</button>}
    {canRefund && <button disabled={busy} onClick={() => void call("refund")} className="rounded-full bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Move to refund processing</button>}
    {canCancelUnpaid && <button disabled={busy} onClick={() => void call("cancel-unpaid")} className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold disabled:opacity-50">Cancel unpaid job</button>}
    {message && <p role="status" className="text-xs text-black/60">{message}</p>}
  </div>;
}
