"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ProductCard } from "./ProductCard";
import { categoryDisplay } from "../../lib/products/category-display";

type Category = { name: string; slug: string };

type Item = {
  id: string;
  name: string;
  customerPrice: number;
  imageUrl: string | null;
  category: { name: string };
};

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
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [products, setProducts] = useState(initialProducts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedCategory = categories.find(
    (item) => item.slug === category,
  );

  // The server already rendered results for the initial query and category; don't refetch them.
  const rendered = useRef({ query: initialQuery, category: initialCategory });

  useEffect(() => {
    if (!query.trim() && !category) return;
    if (query === rendered.current.query && category === rendered.current.category) return;

    const controller = new AbortController();

    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        setError("");

        try {
          const params = new URLSearchParams();

          if (query.trim()) params.set("q", query);
          if (category) params.set("category", category);

          const response = await fetch(`/api/search?${params}`, {
            signal: controller.signal,
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(
              data.error || "Search is temporarily unavailable.",
            );
          }

          setProducts(data.products);
        } catch (e) {
          if (!controller.signal.aborted) {
            setError(
              e instanceof Error
                ? e.message
                : "Search is temporarily unavailable.",
            );
          }
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        }
      },
      query.trim() ? 250 : 0,
    );

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

    syncUrl(params);
  }

  // Keep the URL shareable without a server round-trip or remounting this component.
  function syncUrl(params: URLSearchParams) {
    window.history.replaceState(null, "", `/search${params.size ? `?${params}` : ""}`);
  }

  function setFilter(value: string) {
    setCategory(value);

    const params = new URLSearchParams();

    if (query.trim()) params.set("q", query.trim());
    if (value) params.set("category", value);

    syncUrl(params);
  }

  const requestUrl = `/product-requests${
    query.trim() ? `?name=${encodeURIComponent(query.trim())}` : ""
  }`;

  return (
    <>
      <form action="/search" role="search" onSubmit={submit} className="mt-5 flex gap-2 sm:mt-6">
        <label htmlFor="search-input" className="sr-only">Search products</label>
        <input
          id="search-input"
          name="q"
          type="search"
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
          placeholder="Search food, stationery, chargers…"
          aria-controls="search-results"
          className="pk-input min-w-0 flex-1"
        />
        <button type="submit" className="pk-btn pk-btn-primary pk-btn-lg shrink-0">Search</button>
      </form>

      <div role="group" aria-label="Filter by category" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
        <button type="button" onClick={() => setFilter("")} aria-pressed={!category} className="pk-chip">All</button>
        {categories.map((item) => (
          <button key={item.slug} type="button" onClick={() => setFilter(item.slug)} aria-pressed={category === item.slug} className="pk-chip">
            <span aria-hidden="true">{categoryDisplay(item.slug).icon}</span>
            {item.name}
          </button>
        ))}
        <Link href="/printing" className="pk-chip border-dashed">
          <span aria-hidden="true">🖨️</span>
          Printing <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="mt-4 flex min-h-6 items-center justify-between gap-3">
        <p className="text-sm font-semibold text-black/70" aria-live="polite">
          {query.trim()
            ? `${products.length} ${products.length === 1 ? "result" : "results"} for “${query.trim()}”`
            : selectedCategory
              ? `${products.length} ${products.length === 1 ? "item" : "items"} in ${selectedCategory.name}`
              : products.length
                ? "Newest on PackAM"
                : ""}
        </p>
        {loading && <span role="status" className="text-xs font-semibold text-black/60">Searching…</span>}
      </div>

      {error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          <span>{error}</span>
          <button type="button" onClick={() => setFilter(category)} className="pk-btn pk-btn-secondary pk-btn-sm">Try again</button>
        </div>
      )}

      {products.length > 0 && (
        <div id="search-results" aria-busy={loading} className={`mt-4 grid grid-cols-2 gap-3 transition-opacity sm:gap-4 md:grid-cols-3 lg:grid-cols-4 ${loading ? "opacity-60" : ""}`}>
          {products.map((item) => (
            <ProductCard key={item.id} id={item.id} name={item.name} price={item.customerPrice} image={item.imageUrl} category={item.category.name} />
          ))}
        </div>
      )}

      {!products.length && !loading && !error && (query.trim() || category) && (
        <div className="pk-empty mt-5">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff4c7] text-2xl" aria-hidden="true">{selectedCategory ? categoryDisplay(selectedCategory.slug).icon : "🔎"}</span>
          <h2 className="mt-4 text-lg font-black">{query.trim() ? "We no see am" : `No ${selectedCategory?.name.toLowerCase() ?? "products"} listed yet`}</h2>
          <p className="pk-muted mt-1 max-w-md text-sm leading-6">
            {query.trim()
              ? `Nothing matches “${query.trim()}” right now. Request it and we’ll check campus shops for you.`
              : "This shelf is still being stocked. Tell us what you need and we’ll check around campus."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href={requestUrl} className="pk-btn pk-btn-primary">Request {query.trim() ? "this item" : "an item"}</Link>
            {category && <button type="button" onClick={() => setFilter("")} className="pk-btn pk-btn-secondary">Browse everything</button>}
          </div>
        </div>
      )}

      {!products.length && !loading && !error && !query.trim() && !category && (
        <p className="pk-muted mt-5 text-sm">Start typing, or pick a category above.</p>
      )}
    </>
  );
}
