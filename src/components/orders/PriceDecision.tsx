"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function PriceDecision({ orderId, sourcingId }: { orderId: string; sourcingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(decision: "CONTINUE" | "CANCEL") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "price-decision", sourcingId, decision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save your choice.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your choice."); setBusy(false); }
  }
  return <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} onClick={() => decide("CONTINUE")} className="rounded-full bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Continue</button><button disabled={busy} onClick={() => decide("CANCEL")} className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold disabled:opacity-50">Cancel &amp; request refund</button>{error && <p role="alert" className="basis-full text-xs text-red-700">{error}</p>}</div>;
}
