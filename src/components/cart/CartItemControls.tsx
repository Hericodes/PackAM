"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCartExperience } from "./CartExperience";

type CartItemControlsProps = {
  itemId: string;
  quantity: number;
};

export function CartItemControls({
  itemId,
  quantity,
}: CartItemControlsProps) {
  const router = useRouter();
  const { refresh } = useCartExperience();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function updateQuantity(newQuantity: number) {
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      if (newQuantity < 1) {
        const response = await fetch("/api/cart", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            itemId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to remove item.");
        }
      } else {
        const response = await fetch("/api/cart", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            itemId,
            quantity: newQuantity,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to update quantity.");
        }
      }

      await refresh();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update your cart.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex w-fit items-center rounded-full border border-black/10 bg-[#fffdf7]">
        <button
          type="button"
          onClick={() => updateQuantity(quantity - 1)}
          disabled={loading}
          className="flex h-11 w-11 items-center justify-center rounded-l-full text-lg font-black transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Decrease quantity"
        >
          −
        </button>

        <span className="w-9 text-center text-sm font-black">
          {loading ? "..." : quantity}
        </span>

        <button
          type="button"
          onClick={() => updateQuantity(quantity + 1)}
          disabled={loading || quantity >= 99}
          className="flex h-11 w-11 items-center justify-center rounded-r-full text-lg font-black transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs font-semibold text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => updateQuantity(0)}
        disabled={loading}
        className="mt-2 inline-flex min-h-11 items-center text-xs font-bold text-black/70 underline underline-offset-4 transition hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-40"
      >
        Remove
      </button>
    </div>
  );
}
