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
  return (
    <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap" aria-busy={busy}>
      <button type="button" disabled={busy} onClick={() => decide("CONTINUE")} className="min-h-11 w-full rounded-full bg-black px-5 py-2 text-sm font-bold text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Continue</button>
      <button type="button" disabled={busy} onClick={() => decide("CANCEL")} className="min-h-11 w-full rounded-full border border-black/15 px-5 py-2 text-sm font-bold transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Cancel &amp; request refund</button>
      {error && <p role="alert" className="text-sm leading-5 text-red-700 sm:basis-full">{error}</p>}
    </div>
  );
}
