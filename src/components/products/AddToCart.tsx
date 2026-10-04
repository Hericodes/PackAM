"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCartExperience } from "../cart/CartExperience";

type AddToCartProps = { productId: string };

export function AddToCart({ productId }: AddToCartProps) {
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
    {added && <p role="status" className="mt-3 text-sm font-bold text-green-800">Added to cart 🫡 Keep shopping.</p>}
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
  </div>;
}
