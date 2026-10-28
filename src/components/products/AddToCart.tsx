"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCartExperience } from "../cart/CartExperience";
import { Icon } from "../ui/Icon";

type AddToCartProps = { productId: string; compact?: boolean };

export function AddToCart({ productId, compact = false }: AddToCartProps) {
  const router = useRouter();
  const { adjust, setSummary } = useCartExperience();
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);

  async function handleAddToCart() {
    setLoading(true);
    setError("");
    setAdded(false);
    adjust(quantity);
    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity }),
      });
      const data = await response.json();
      if (response.status === 401) {
        adjust(-quantity);
        router.push(`/login?callbackUrl=${encodeURIComponent(`/products/${productId}`)}`);
        return;
      }
      if (!response.ok) throw new Error(data.error || "Unable to add this item.");
      if (typeof data.summary?.count !== "number" || typeof data.summary?.subtotal !== "number") throw new Error("Unable to update your checkout total.");
      setSummary(data.summary);
      setAdded(true);
    } catch (err) {
      adjust(-quantity);
      setError(err instanceof Error ? err.message : "Unable to add this item. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (compact) {
    // Phones: a 40px round button beside the price (label for screen readers only). From sm up: the full-width labelled button.
    return <div className="flex flex-col items-end sm:block">
      <button
        type="button"
        onClick={handleAddToCart}
        disabled={loading}
        aria-busy={loading}
        className={`group/cart flex h-10 w-10 shrink-0 items-center justify-center whitespace-nowrap rounded-full text-[0.8125rem] font-black sm:h-auto sm:min-h-11 sm:w-full sm:gap-2 sm:px-3 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-wait disabled:opacity-70 ${
          added ? "bg-[#feb80a] text-black hover:bg-[#e5a500]" : "bg-black text-white hover:bg-[#262626]"
        }`}
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
        ) : added ? (
          <Icon name="check" className="h-5 w-5 sm:h-4 sm:w-4" strokeWidth={2.6} />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#feb80a] text-black transition-transform group-hover/cart:scale-110 sm:h-5 sm:w-5">
            <Icon name="plus" className="h-4 w-4 sm:h-3.5 sm:w-3.5" strokeWidth={3} />
          </span>
        )}
        <span className="sr-only sm:not-sr-only">{loading ? "Adding…" : added ? "Add another" : "Add to cart"}</span>
      </button>
      {error && <p role="alert" className="mt-2 max-w-36 text-right text-xs font-semibold leading-4 text-red-700 sm:max-w-none sm:text-left">{error}</p>}
      <span role="status" className="sr-only">{added ? "Added to cart" : ""}</span>
    </div>;
  }

  return <div>
    <div className="flex flex-col gap-2 md:flex-row md:gap-3">
      <div className="flex h-12 w-full items-center justify-between rounded-full border border-black/10 bg-white md:w-auto md:justify-normal">
        <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={loading || quantity === 1} aria-label="Decrease quantity" className="h-12 w-12 rounded-l-full text-lg font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black disabled:opacity-30 md:w-12">−</button>
        <span className="w-8 text-center text-sm font-black">{quantity}</span>
        <button type="button" onClick={() => setQuantity((value) => Math.min(99, value + 1))} disabled={loading || quantity === 99} aria-label="Increase quantity" className="h-12 w-12 rounded-r-full text-lg font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black disabled:opacity-30 md:w-12">+</button>
      </div>
      <button type="button" onClick={handleAddToCart} disabled={loading} className="min-h-12 min-w-0 flex-1 rounded-full bg-black px-4 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50 md:px-6">
        {loading ? "Adding…" : "Add to cart"}
      </button>
    </div>
    {added && <p role="status" className="mt-3 text-sm font-bold text-green-800">Added to cart ✓ E don enter. Check out whenever you’re ready.</p>}
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
  </div>;
}
