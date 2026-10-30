"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ProductCard } from "./ProductCard";
import { categoryDisplay } from "../../lib/products/category-display";
import { appendPage, marketplaceHref, type MarketplacePage } from "../../lib/products/marketplace";
import type { ProductCardData } from "../../lib/products/card";

type Category = { name: string; slug: string; subcategories?: Array<{ name: string; slug: string }> };
type Scope = { category: string; sub: string; label: string };

type Item = ProductCardData;

const SEARCH_ERROR = "Search no dey work right now. Try again in a moment.";

async function fetchPage(query: string, scope: Scope, page: number, signal: AbortSignal): Promise<MarketplacePage<Item>> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (scope.category) params.set("category", scope.category);
  if (scope.category && scope.sub) params.set("sub", scope.sub);
  if (scope.label) params.set("label", scope.label);
  if (page > 1) params.set("page", String(page));
  const response = await fetch(`/api/search${params.size ? `?${params}` : ""}`, { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.products)) throw new Error(typeof data.error === "string" ? data.error : SEARCH_ERROR);
  return data as MarketplacePage<Item>;
}

export function LiveSearch({
  query: initialQuery,
  category: initialCategory,
  categories,
  initialPage,
  labels = [],
  sub: initialSub = "",
  label: initialLabel = "",
}: {
  query: string;
  category: string;
  categories: Category[];
  initialPage: MarketplacePage<Item>;
  /** Labels the admin made available for browsing, e.g. Popular. */
  labels?: Array<{ name: string; slug: string }>;
  sub?: string;
  label?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [sub, setSub] = useState(initialSub);
  const [label, setLabel] = useState(initialLabel);
  const [results, setResults] = useState(initialPage);
  const [loading, setLoading] = useState<"replace" | "more" | null>(null);
  const [error, setError] = useState<{ message: string; retry: "page" | "more" } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const moreRequest = useRef<AbortController | null>(null);

  const selectedCategory = categories.find((item) => item.slug === category);
  const products = results.products;

  // What the grid currently shows. The server rendered the first page for the initial search and category.
  const shown = useRef({ query: initialQuery.trim(), category: initialCategory, sub: initialSub, label: initialLabel, attempt: 0 });
  const subcategories = selectedCategory?.subcategories ?? [];

  // Any change of search, category ("All" included) or a retry loads page 1 again.
  useEffect(() => {
    const wanted = { query: query.trim(), category, sub: category ? sub : "", label, attempt };
    if (wanted.query === shown.current.query && wanted.category === shown.current.category && wanted.sub === shown.current.sub && wanted.label === shown.current.label && wanted.attempt === shown.current.attempt) return;
    moreRequest.current?.abort();
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading("replace");
      setError(null);
      try {
        const page = await fetchPage(wanted.query, wanted, 1, controller.signal);
        if (controller.signal.aborted) return; // a newer filter won; never show stale results
        shown.current = wanted;
        setResults(page);
        // The address always describes what is on screen, including after the search box is cleared.
        window.history.replaceState(null, "", marketplaceHref(wanted.query, wanted.category, wanted));
      } catch (e) {
        if (!controller.signal.aborted) setError({ message: e instanceof Error ? e.message : SEARCH_ERROR, retry: "page" });
      } finally {
        if (!controller.signal.aborted) setLoading(null);
      }
    }, wanted.query !== shown.current.query && wanted.query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, category, sub, label, attempt]);

  async function loadMore() {
    if (loading || !results.hasMore) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoading("more");
    setError(null);
    try {
      const next = await fetchPage(shown.current.query, shown.current, results.page + 1, controller.signal);
      if (controller.signal.aborted) return;
      setResults((current) => ({ ...next, products: appendPage(current.products, next.products) }));
    } catch (e) {
      if (!controller.signal.aborted) setError({ message: e instanceof Error ? e.message : SEARCH_ERROR, retry: "more" });
    } finally {
      if (!controller.signal.aborted) setLoading(null);
    }
  }

  // Keep the URL shareable without a server round-trip or remounting this component.
  function syncUrl(nextQuery: string, nextCategory: string, narrow: { sub?: string; label?: string } = { sub, label }) {
    window.history.replaceState(null, "", marketplaceHref(nextQuery, nextCategory, narrow));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    syncUrl(query, category);
  }

  function setFilter(value: string) {
    // A new category starts without a subcategory.
    setCategory(value);
    setSub("");
    syncUrl(query, value, { label });
  }

  function chooseSub(value: string) {
    setSub(value);
    syncUrl(query, category, { sub: value, label });
  }

  function toggleLabel(value: string) {
    const next = label === value ? "" : value;
    setLabel(next);
    syncUrl(query, category, { sub, label: next });
  }

  const searching = Boolean(query.trim());
  const replacing = loading === "replace";
  const requestUrl = `/product-requests${searching ? `?name=${encodeURIComponent(query.trim())}` : ""}`;
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

  return (
    <>
      <form action="/search" role="search" onSubmit={submit} className="mt-3 flex gap-2 sm:mt-6">
        <label htmlFor="search-input" className="sr-only">Search products</label>
        <input
          id="search-input"
          name="q"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search food, stationery, chargers…"
          aria-controls="search-results"
          className="pk-input min-h-11 min-w-0 flex-1 sm:min-h-12"
        />
        <button type="submit" className="pk-btn pk-btn-primary shrink-0 px-4 sm:min-h-[52px] sm:px-6 sm:text-[0.9375rem]">Search</button>
      </form>

      <div role="group" aria-label="Filter by category" className="-mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:mt-4 sm:flex-wrap sm:gap-2 sm:px-0 sm:pb-2 [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => setFilter("")} aria-pressed={!category} className="pk-chip min-h-9 shrink-0 px-3.5 text-[0.8125rem] sm:min-h-10 sm:px-4 sm:text-sm">All</button>
        {categories.map((item) => (
          <button key={item.slug} type="button" onClick={() => setFilter(item.slug)} aria-pressed={category === item.slug} className="pk-chip min-h-9 shrink-0 px-3 text-[0.8125rem] sm:min-h-10 sm:px-4 sm:text-sm">
            <span aria-hidden="true">{categoryDisplay(item.slug).icon}</span>
            {item.name}
          </button>
        ))}
        <Link href="/printing" className="pk-chip min-h-9 shrink-0 border-dashed px-3 text-[0.8125rem] sm:min-h-10 sm:px-4 sm:text-sm">
          <span aria-hidden="true">🖨️</span>
          Printing <span aria-hidden="true">→</span>
        </Link>
      </div>

      {subcategories.length > 0 && (
        <div role="group" aria-label={`Filter ${selectedCategory?.name ?? ""} by type`} className="-mx-4 mt-1.5 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => chooseSub("")} aria-pressed={!sub} className="pk-chip min-h-8 shrink-0 px-3 text-xs">All {selectedCategory?.name}</button>
          {subcategories.map((item) => (
            <button key={item.slug} type="button" onClick={() => chooseSub(item.slug)} aria-pressed={sub === item.slug} className="pk-chip min-h-8 shrink-0 px-3 text-xs">{item.name}</button>
          ))}
        </div>
      )}

      {labels.length > 0 && (
        <div role="group" aria-label="Filter by label" className="-mx-4 mt-1.5 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
          {labels.map((item) => (
            <button key={item.slug} type="button" onClick={() => toggleLabel(item.slug)} aria-pressed={label === item.slug} className={`min-h-8 shrink-0 rounded-full border px-3 text-xs font-black ${label === item.slug ? "border-[#feb80a] bg-[#feb80a] text-black" : "border-[#feb80a]/50 bg-[#fff4c7] text-[#6b4700]"}`}>
              {label === item.slug ? "✓ " : ""}{item.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex min-h-5 items-center justify-between gap-3 sm:mt-4 sm:min-h-6">
        <p className="text-[0.8125rem] font-semibold text-black/70 sm:text-sm" aria-live="polite">
          {replacing
            ? ""
            : searching
              ? `${plural(results.total, "result", "results")} for “${query.trim()}”`
              : selectedCategory
                ? `${plural(results.total, "item", "items")} in ${selectedCategory.name}`
                : results.total
                  ? `Newest on PackAM · ${plural(results.total, "item", "items")}`
                  : ""}
        </p>
        {replacing && <span role="status" className="text-xs font-semibold text-black/60">Loading…</span>}
      </div>

      {error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          <span>{error.message}</span>
          <button type="button" onClick={() => (error.retry === "more" ? void loadMore() : setAttempt((n) => n + 1))} className="pk-btn pk-btn-secondary pk-btn-sm">Try again</button>
        </div>
      )}

      {products.length > 0 && (
        <div id="search-results" aria-busy={replacing} className={`pk-product-grid mt-2 transition-opacity sm:mt-4 ${replacing ? "opacity-60" : ""}`}>
          {products.map((item) => (
            <ProductCard key={item.id} id={item.id} name={item.name} price={item.customerPrice} image={item.imageUrl} category={item.category.name} labels={item.labels} hasOptions={item.hasOptions} priceVaries={item.priceVaries} outOfStock={item.outOfStock} />
          ))}
        </div>
      )}

      {products.length > 0 && (results.hasMore || loading === "more") && (
        <div className="mt-5 flex flex-col items-center gap-2 sm:mt-6">
          <button type="button" onClick={() => void loadMore()} disabled={loading !== null} aria-busy={loading === "more"} className="pk-btn pk-btn-secondary w-full sm:w-auto sm:px-8">
            {loading === "more" ? "Loading…" : "Show more"}
          </button>
          <p className="text-xs text-black/50">Showing {products.length} of {results.total}</p>
        </div>
      )}

      {!products.length && !loading && !error && (
        <div className="pk-empty mt-4 px-4 py-8 sm:mt-5 sm:px-5 sm:py-10">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff4c7] text-2xl sm:h-14 sm:w-14" aria-hidden="true">{selectedCategory ? categoryDisplay(selectedCategory.slug).icon : "🔎"}</span>
          <h2 className="mt-3 text-lg font-black sm:mt-4">{searching ? "We no see am" : selectedCategory ? `No ${selectedCategory.name.toLowerCase()} listed yet` : "The shelf dey empty for now"}</h2>
          <p className="pk-muted mt-1 max-w-md text-sm leading-6">
            {searching
              ? `We no see “${query.trim()}” on the shelf yet. Request am — we go check campus shops for you.`
              : "Tell us wetin you need and we go check around campus."}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:mt-5">
            <Link href={requestUrl} className="pk-btn pk-btn-primary">Request {searching ? "this item" : "an item"}</Link>
            {(category || searching) && <button type="button" onClick={() => { setQuery(""); setCategory(""); syncUrl("", ""); }} className="pk-btn pk-btn-secondary">Browse everything</button>}
          </div>
        </div>
      )}
    </>
  );
}
