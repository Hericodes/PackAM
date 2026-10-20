"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProductCard, ProductCardSkeleton } from "../student/ProductCard";
import { useSavedProducts } from "./useSavedProducts";

type Product = { id: string; name: string; customerPrice: number; imageUrl: string | null; category: { name: string } };

export function SavedProducts() {
  const { ids, ready } = useSavedProducts();
  const [products, setProducts] = useState<Product[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const key = ids.join(",");

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!key) { setProducts([]); setState("ready"); return; }
    setState("loading");
    try {
      const response = await fetch(`/api/catalogue?ids=${encodeURIComponent(key)}`, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const byId = new Map((data.products as Product[]).map((product) => [product.id, product]));
      setProducts(key.split(",").flatMap((id) => byId.get(id) ?? []));
      setState("ready");
    } catch {
      if (!signal?.aborted) setState("error");
    }
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [ready, load]);

  if (!ready || state === "loading") {
    return (
      <div className="pk-product-grid mt-6" aria-busy="true" aria-label="Loading saved items">
        {[0, 1, 2, 3].map((n) => <ProductCardSkeleton key={n} />)}
      </div>
    );
  }
  if (state === "error") {
    return (
      <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
        <span>Saved items couldn’t load.</span>
        <button type="button" onClick={() => void load()} className="pk-btn pk-btn-secondary pk-btn-sm">Try again</button>
      </div>
    );
  }

  const unavailable = ids.length - products.length;
  if (!products.length) {
    return (
      <div className="pk-empty mt-6">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff4c7] text-2xl" aria-hidden="true">♡</span>
        <h2 className="mt-4 text-lg font-black">{ids.length ? "Your saved items aren’t available right now" : "Nothing saved yet"}</h2>
        <p className="pk-muted mt-1 max-w-sm text-sm leading-6">Tap the heart on anything wey catch your eye, and e go dey here for next time.</p>
        <Link href="/search" className="pk-btn pk-btn-primary mt-5">Browse products</Link>
      </div>
    );
  }
  return (
    <>
      {unavailable > 0 && <p className="pk-muted mt-5 text-sm">{unavailable} saved item{unavailable === 1 ? " is" : "s are"} no longer available and hidden.</p>}
      <div className="pk-product-grid mt-6">
        {products.map((product) => (
          <ProductCard key={product.id} id={product.id} name={product.name} price={product.customerPrice} image={product.imageUrl} category={product.category.name} />
        ))}
      </div>
    </>
  );
}
