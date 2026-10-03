"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ShakeCheckout } from "./ShakeCheckout";

type CartSummary = { count: number; subtotal: number };
type CartContextValue = CartSummary & { refresh: () => Promise<void>; adjust: (delta: number) => void; setSummary: (summary: CartSummary) => void };
const CartContext = createContext<CartContextValue | null>(null);
const shoppingPath = (path: string) => path === "/" || path === "/search" || path.startsWith("/products/") || path.startsWith("/category/");

export function CartExperience({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [subtotal, setSubtotal] = useState(0);
  const [isStudent, setIsStudent] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/cart", { cache: "no-store" });
      if (!response.ok) { setIsStudent(false); setCount(0); setSubtotal(0); return; }
      const data = await response.json();
      setIsStudent(true);
      setCount(data.summary?.count ?? (data.cart?.items ?? []).reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0));
      setSubtotal(data.summary?.subtotal ?? (data.cart?.items ?? []).reduce((sum: number, item: { quantity: number; product: { customerPrice: number } }) => sum + item.quantity * item.product.customerPrice, 0));
    } catch { /* Keep the last known cart state when temporarily offline. */ }
  }, []);
  const adjust = useCallback((delta: number) => setCount((current) => Math.max(0, current + delta)), []);
  const setSummary = useCallback((summary: CartSummary) => {
    setCount(summary.count);
    setSubtotal(summary.subtotal);
    setIsStudent(true);
  }, []);

  useEffect(() => {
    if (!shoppingPath(pathname)) return;
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, refresh]);

  const value = useMemo(() => ({ count, subtotal, refresh, adjust, setSummary }), [count, subtotal, refresh, adjust, setSummary]);
  const showCheckout = shoppingPath(pathname) && isStudent && count > 0;
  return <CartContext.Provider value={value}>
    {children}
    {showCheckout && <>
      <ShakeCheckout />
      <Link href="/checkout" aria-label={`Checkout, ${count} ${count === 1 ? "item" : "items"}, subtotal ₦${subtotal.toLocaleString()}`} className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-black px-5 text-sm font-black text-white shadow-lg ring-1 ring-white/30 transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:bottom-7 sm:right-7 sm:px-6">
        <span aria-hidden="true">🛒</span><span>Checkout · ₦{subtotal.toLocaleString()}</span><span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#feb80a] px-1.5 text-xs text-black">{count}</span>
      </Link>
    </>}
  </CartContext.Provider>;
}

export function useCartExperience() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCartExperience must be used inside CartExperience");
  return context;
}
