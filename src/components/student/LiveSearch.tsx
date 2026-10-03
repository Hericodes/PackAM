"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AddToCart } from "../products/AddToCart";

type Category = { name: string; slug: string };
type Item = { id: string; name: string; customerPrice: number; imageUrl: string | null; category: { name: string } };

export function LiveSearch({ query: initialQuery, category: initialCategory, categories, initialProducts }: { query: string; category: string; categories: Category[]; initialProducts: Item[] }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [products, setProducts] = useState(initialProducts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!query.trim() && !category) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query);
        if (category) params.set("category", category);
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Search is temporarily unavailable.");
        setProducts(data.products);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Search is temporarily unavailable.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, query.trim() ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, category]);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const params = new URLSearchParams(); if (query.trim()) params.set("q", query.trim()); if (category) params.set("category", category); router.replace(`/search${params.size ? `?${params}` : ""}`, { scroll: false }); }
  function setFilter(value: string) { setCategory(value); const params = new URLSearchParams(); if (query.trim()) params.set("q", query.trim()); if (value) params.set("category", value); router.replace(`/search${params.size ? `?${params}` : ""}`, { scroll: false }); }
  const requestUrl = `/product-requests${query.trim() ? `?name=${encodeURIComponent(query.trim())}` : ""}`;
  return <>
    <form action="/search" onSubmit={submit} className="mt-5 flex gap-2"><input value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (!value.trim() && !category) { setProducts([]); setLoading(false); setError(""); } }} placeholder="Search products" aria-label="Search products" aria-controls="search-results" className="packam-input min-w-0 flex-1"/><button type="submit" className="min-h-12 rounded-full bg-black px-5 text-sm font-black text-white">Search</button></form>
    <div className="mt-4 flex gap-2 overflow-x-auto pb-1"><button type="button" onClick={() => setFilter("")} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${!category ? "bg-[#feb80a]" : "bg-white"}`}>All</button>{categories.map((item) => <button key={item.slug} type="button" onClick={() => setFilter(item.slug)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${category === item.slug ? "bg-[#feb80a]" : "bg-white"}`}>{item.name}</button>)}</div>
    <div className="mt-6 flex items-center justify-between"><p className="text-sm font-semibold text-black/50" aria-live="polite">{query.trim() ? `${products.length} ${products.length === 1 ? "item" : "items"} for “${query}”` : "Browse around campus"}</p>{loading && <span className="text-xs font-semibold text-black/45">Searching…</span>}</div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div id="search-results" aria-busy={loading} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">{products.map((item) => <article key={item.id} className="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm"><Link href={`/products/${item.id}`} className="block"><div className="relative aspect-square bg-[#f3f3f3]">{item.imageUrl ? <Image src={item.imageUrl} alt={item.name} fill className="object-cover"/> : <div className="flex h-full items-center justify-center text-5xl" aria-hidden="true">📦</div>}</div><div className="p-4 pb-2"><p className="text-xs font-bold uppercase tracking-wide text-black/40">{item.category.name}</p><h2 className="mt-1 line-clamp-2 text-sm font-black leading-5">{item.name}</h2><p className="mt-3 text-base font-black">₦{item.customerPrice.toLocaleString()}</p></div></Link><div className="px-4 pb-4"><AddToCart productId={item.id}/></div></article>)}</div>
    {!products.length && query.trim() && !loading && !error && <div className="mt-5 rounded-3xl bg-white px-6 py-10 text-center"><p className="font-black">Nothing here yet 👀</p><p className="mt-1 text-sm text-black/55">Can&apos;t find what you&apos;re looking for?</p><Link href={requestUrl} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-black px-5 text-sm font-black text-white">Request this product 🫡</Link></div>}
    {!query.trim() && <p className="mt-5 rounded-3xl bg-white px-6 py-10 text-center text-sm text-black/55">Start typing to find something around campus.</p>}
  </>;
}
