"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AddToCart } from "../products/AddToCart";

type Category = { name: string; slug: string };
type Item = { id: string; name: string; customerPrice: number; imageUrl: string | null; category: { name: string } };

export function LiveSearch({
  query: initialQuery,
  category: initialCategory,
  categories,
  initialProducts,
}: {
  query: string;
  category: string;
  categories: Category[];
  initialProducts: Item[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [products, setProducts] = useState(initialProducts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedCategory = categories.find((item) => item.slug === category);

  useEffect(() => {
    if (!query.trim() && !category) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
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
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, category]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category) params.set("category", category);
    router.replace(`/search${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  function setFilter(value: string) {
    setCategory(value);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (value) params.set("category", value);
    router.replace(`/search${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  const requestUrl = `/product-requests${query.trim() ? `?name=${encodeURIComponent(query.trim())}` : ""}`;

  return (
    <>
      <form action="/search" onSubmit={submit} className="mt-5 flex gap-2 sm:mt-6">
        <input
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            if (!value.trim() && !category) {
              setProducts([]);
              setLoading(false);
              setError("");
            }
          }}
          placeholder="Search products"
          aria-label="Search products"
          aria-controls="search-results"
          className="packam-input min-w-0 flex-1 text-base"
        />
        <button
          type="submit"
          className="min-h-12 shrink-0 rounded-full bg-[#080808] px-4 text-sm font-black text-white transition hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:px-6"
        >
          Search
        </button>
      </form>

      <div
        role="group"
        aria-label="Filter by category"
        className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
      >
        <button
          type="button"
          onClick={() => setFilter("")}
          aria-pressed={!category}
          className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${
            !category ? "bg-[#feb80a] text-black" : "bg-white text-black/70 hover:bg-[#fff4c7]"
          }`}
        >
          All
        </button>
        {categories.map((item) => (
          <button
            key={item.slug}
            type="button"
            onClick={() => setFilter(item.slug)}
            aria-pressed={category === item.slug}
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${
              category === item.slug ? "bg-[#feb80a] text-black" : "bg-white text-black/70 hover:bg-[#fff4c7]"
            }`}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="mt-5 flex min-h-6 items-center justify-between gap-3 sm:mt-6">
        <p className="text-sm font-semibold text-black/60" aria-live="polite">
          {query.trim()
            ? `${products.length} ${products.length === 1 ? "item" : "items"} for “${query}”`
            : selectedCategory
              ? `${products.length} ${products.length === 1 ? "item" : "items"} in ${selectedCategory.name}`
              : "Browse around campus"}
        </p>
        {loading && <span className="text-xs font-semibold text-black/55">Searching…</span>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      <div
        id="search-results"
        aria-busy={loading}
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
      >
        {products.map((item) => (
          <article key={item.id} className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition-shadow hover:shadow-md sm:rounded-3xl">
            <Link
              href={`/products/${item.id}`}
              aria-label={`View ${item.name}`}
              className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black"
            >
              <div className="relative aspect-square bg-[#f3f3f3]">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-5xl" aria-hidden="true">📦</div>
                )}
              </div>
              <div className="p-3 pb-2 sm:p-4 sm:pb-2">
                <p className="text-xs font-bold uppercase tracking-wide text-black/60">{item.category.name}</p>
                <h2 className="mt-1 line-clamp-2 text-base font-black leading-5">{item.name}</h2>
                <p className="mt-2 text-base font-black sm:mt-3 sm:text-lg">₦{item.customerPrice.toLocaleString()}</p>
              </div>
            </Link>
            <div className="px-3 pb-3 sm:px-4 sm:pb-4"><AddToCart productId={item.id} /></div>
          </article>
        ))}
      </div>

      {!products.length && !loading && !error && (query.trim() || category) && (
        <div className="mt-5 rounded-3xl border border-black/5 bg-white px-5 py-8 text-center sm:px-6 sm:py-10">
          <p className="text-lg font-black">Nothing here yet 👀</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-black/60">
            {query.trim()
              ? `We couldn’t find “${query.trim()}”. Try another search or tell us what you need.`
              : `We don’t have any ${selectedCategory?.name.toLowerCase() ?? "products"} listed right now. Tell us what you need and we’ll check around.`}
          </p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            {category && (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-black/10 px-5 text-sm font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                Browse all products
              </button>
            )}
            <Link
              href={requestUrl}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#080808] px-5 text-sm font-black text-white transition hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Request this product 🫡
            </Link>
          </div>
        </div>
      )}

      {!query.trim() && !category && (
        <p className="mt-5 rounded-3xl border border-black/5 bg-white px-5 py-8 text-center text-sm leading-6 text-black/60 sm:px-6 sm:py-10">
          Start typing to find something around campus, or choose a category above.
        </p>
      )}
    </>
  );
}
