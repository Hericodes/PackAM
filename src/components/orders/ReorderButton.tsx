"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { summariseReorder, type ReorderResult } from "../../lib/reorder";
import { useCartExperience } from "../cart/CartExperience";

type Item = { productId: string; name: string; quantity: number };

/** Re-adds a past order's items through the normal cart API (same checks, current prices). */
export function ReorderButton({ items, size = "default" }: { items: Item[]; size?: "default" | "small" }) {
  const router = useRouter();
  const { setSummary } = useCartExperience();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ added: number; message: string } | null>(null);

  async function reorder() {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    const results: ReorderResult[] = [];
    for (const item of items) {
      try {
        const response = await fetch("/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: item.productId, quantity: Math.min(99, Math.max(1, item.quantity)) }),
        });
        if (response.status === 401) {
          router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        const data = await response.json();
        if (response.ok && data.summary) setSummary(data.summary);
        results.push({ name: item.name, added: response.ok });
      } catch {
        results.push({ name: item.name, added: false });
      }
    }
    setOutcome(summariseReorder(results));
    setBusy(false);
  }

  return (
    <div>
      <button type="button" onClick={() => void reorder()} disabled={busy || !items.length} className={`pk-btn pk-btn-secondary ${size === "small" ? "pk-btn-sm" : ""}`}>
        <span aria-hidden="true">↻</span>
        {busy ? "Adding to cart…" : "Order again"}
      </button>
      {outcome && (
        <div role="status" className="mt-3 text-sm leading-6">
          <p className={outcome.added ? "font-semibold text-green-800" : "font-semibold text-black/75"}>{outcome.message}</p>
          {outcome.added > 0 && <Link href="/checkout" className="pk-btn pk-btn-primary pk-btn-sm mt-2">Review cart &amp; check out</Link>}
        </div>
      )}
    </div>
  );
}
