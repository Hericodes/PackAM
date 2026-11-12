"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CHECKOUT_PATH } from "../../lib/food/cart-context";

/**
 * Shown when food from another shop can't join the food cart (one food order comes from one shop; Order Stuff has its
 * own cart and never conflicts). The student decides: check out the current food order, or clear the food cart and
 * add this. Nothing is cleared unless they choose it, and the shop cart is never touched.
 */
export function CartConflictDialog({ message, busy, onClear, onClose }: { message: string; busy: boolean; onClear: () => void; onClose: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cart-conflict-title" aria-describedby="cart-conflict-body" className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
        <h2 id="cart-conflict-title" className="text-lg font-black">Your food cart has another shop’s order</h2>
        <p id="cart-conflict-body" className="mt-2 text-sm leading-6 text-black/70">{message}</p>
        <div className="mt-4 grid gap-2">
          <Link href={CHECKOUT_PATH.food} className="pk-btn pk-btn-primary">Go to food checkout</Link>
          <button type="button" onClick={onClear} disabled={busy} aria-busy={busy} className="pk-btn pk-btn-secondary">{busy ? "Clearing…" : "Clear food cart and add this"}</button>
          <button ref={keepRef} type="button" onClick={onClose} disabled={busy} className="pk-btn pk-btn-ghost">Keep my food cart</button>
        </div>
      </div>
    </div>
  );
}
