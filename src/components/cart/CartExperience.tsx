"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ShakeCheckout } from "./ShakeCheckout";
import { CHECKOUT_PATH, type CartSection } from "../../lib/food/cart-context";

/** Both carts together (the navbar badge), and each cart on its own (the floating checkout buttons). */
export type CartSummary = {
  count: number;
  subtotal: number;
  food: { count: number; subtotal: number; shopName: string | null };
  stuff: { count: number; subtotal: number };
};
type CartContextValue = CartSummary & { refresh: () => Promise<void>; adjust: (delta: number) => void; setSummary: (summary: Partial<CartSummary> & { count: number; subtotal: number }) => void };
const CartContext = createContext<CartContextValue | null>(null);
const EMPTY: CartSummary = { count: 0, subtotal: 0, food: { count: 0, subtotal: 0, shopName: null }, stuff: { count: 0, subtotal: 0 } };

const foodPath = (path: string) => path === "/food" || path.startsWith("/food/");
const shopPath = (path: string) => path === "/search" || path.startsWith("/products/") || path.startsWith("/category/");
/** Which cart the floating button checks out on this page: food pages the food cart, shop pages the shop cart. */
const pageSection = (path: string): CartSection | null => (foodPath(path) ? "food" : shopPath(path) ? "stuff" : null);
const cartSyncPath = (path: string) => pageSection(path) !== null || path === "/" || path === "/checkout" || path.startsWith("/checkout/") || path.startsWith("/orders/") || path === "/orders" || path === "/product-requests" || path === "/support" || path === "/notifications" || path === "/cart" || path === "/saved" || path === "/account" || path === "/printing";

/** An older server's answer (count and subtotal only) keeps the last known split rather than inventing one. */
function withSections(next: Partial<CartSummary> & { count: number; subtotal: number }, previous: CartSummary): CartSummary {
  return { count: next.count, subtotal: next.subtotal, food: next.food ?? previous.food, stuff: next.stuff ?? previous.stuff };
}

export function CartExperience({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [summary, setSummaryState] = useState<CartSummary>(EMPTY);
  const [isStudent, setIsStudent] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/cart", { cache: "no-store" });
      // Signed out or not a student: no cart. A server error (e.g. 503 while PackAM updates) says nothing
      // about the cart, so the last known count stays rather than showing an empty cart.
      if (response.status === 401 || response.status === 403) { setIsStudent(false); setSummaryState(EMPTY); return; }
      if (!response.ok) return;
      const data = await response.json();
      setIsStudent(true);
      if (data.summary && typeof data.summary.count === "number") setSummaryState((previous) => withSections(data.summary, previous));
    } catch { /* Keep the last known cart state when temporarily offline. */ }
  }, []);
  // An optimistic change while an Order Stuff item is being added (AddToCart); the server's summary follows.
  const adjust = useCallback((delta: number) => setSummaryState((current) => ({ ...current, count: Math.max(0, current.count + delta), stuff: { ...current.stuff, count: Math.max(0, current.stuff.count + delta) } })), []);
  const setSummary = useCallback((next: Partial<CartSummary> & { count: number; subtotal: number }) => {
    setSummaryState((previous) => withSections(next, previous));
    setIsStudent(true);
  }, []);

  useEffect(() => {
    if (!cartSyncPath(pathname)) return;
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, refresh]);

  const value = useMemo(() => ({ ...summary, refresh, adjust, setSummary }), [summary, refresh, adjust, setSummary]);
  const section = pageSection(pathname);
  const sectionCart = section ? summary[section] : null;
  const showCheckout = section !== null && sectionCart !== null && isStudent && sectionCart.count > 0;
  const label = section === "food" ? "Food checkout" : "Checkout";
  return <CartContext.Provider value={value}>
    {children}
    {showCheckout && section && sectionCart && <>
      {/* Room at the end of the page, so the floating button never covers the last products. */}
      <div aria-hidden="true" className="h-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:h-24" />
      <ShakeCheckout href={CHECKOUT_PATH[section]} />
      <Link href={CHECKOUT_PATH[section]} aria-label={`${label}, ${sectionCart.count} ${sectionCart.count === 1 ? "item" : "items"}, subtotal ₦${sectionCart.subtotal.toLocaleString()}`} className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-black px-5 text-sm font-black text-white shadow-lg ring-1 ring-white/30 transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:bottom-7 sm:right-7 sm:px-6">
        <span aria-hidden="true">{section === "food" ? "🍲" : "🛒"}</span><span>{label} · ₦{sectionCart.subtotal.toLocaleString()}</span><span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#feb80a] px-1.5 text-xs text-black">{sectionCart.count}</span>
      </Link>
    </>}
  </CartContext.Provider>;
}

export function useCartExperience() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCartExperience must be used inside CartExperience");
  return context;
}
