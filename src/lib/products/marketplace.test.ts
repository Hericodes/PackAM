import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MARKETPLACE_PAGE_SIZE, appendPage, marketplaceHref, marketplacePage, rankProducts, searchTerms } from "./marketplace";
import { LiveSearch } from "../../components/student/LiveSearch";
import { CartExperience } from "../../components/cart/CartExperience";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const page = (props: Parameters<typeof LiveSearch>[0]) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, createElement(PathnameContext.Provider, { value: "/search" }, createElement(CartExperience, null, createElement(LiveSearch, props)))));

const item = (id: string, name: string, category = "Academic Materials") => ({ id, name, customerPrice: 100, imageUrl: null, description: null, category: { name: category }, labels: [] as string[], hasOptions: false, priceVaries: false, outOfStock: false });

test("'All' is the plain marketplace URL; a filter change never keeps a page number", () => {
  assert.equal(marketplaceHref("", ""), "/search");
  assert.equal(marketplaceHref("  ", ""), "/search");
  assert.equal(marketplaceHref("", "food-drinks"), "/search?category=food-drinks");
  assert.equal(marketplaceHref(" pen ", ""), "/search?q=pen", "All with a search keeps the search");
  assert.equal(marketplaceHref("pen", "academic-materials"), "/search?q=pen&category=academic-materials");
});

test("paging: there is more until every product has been shown", () => {
  assert.deepEqual(marketplacePage([], 0, 1), { products: [], total: 0, page: 1, hasMore: false });
  assert.equal(marketplacePage([], 31, 1).hasMore, true, "31 visible products: page 1 of 2");
  assert.equal(marketplacePage([], 31, 2).hasMore, false);
  assert.equal(marketplacePage([], MARKETPLACE_PAGE_SIZE, 1).hasMore, false, "exactly one page");
});

test("showing more never repeats a product", () => {
  const shown = [item("a", "A"), item("b", "B")];
  assert.deepEqual(appendPage(shown, [item("b", "B"), item("c", "C")]).map((p) => p.id), ["a", "b", "c"]);
});

test("search ranking: exact, then starts-with, then contains; ties are stable", () => {
  const ranked = rankProducts([item("1", "Ruler (Long)"), item("2", "Blue Pen"), item("3", "Pen"), item("4", "Pencil"), item("5", "Black Pen")], "pen", searchTerms("pen"));
  assert.deepEqual(ranked.map((p) => p.name), ["Pen", "Pencil", "Black Pen", "Blue Pen", "Ruler (Long)"]);
  assert.deepEqual(searchTerms("a  Pen pen"), ["pen"], "one-letter terms and repeats are dropped");
});

test("on first load 'All' is selected, the count is shown, and more pages are reachable", () => {
  const products = Array.from({ length: MARKETPLACE_PAGE_SIZE }, (_, i) => item(`p${i}`, `Product ${i}`));
  const html = page({
    query: "",
    category: "",
    categories: [{ name: "Academic Materials", slug: "academic-materials" }, { name: "Food & Drinks", slug: "food-drinks" }],
    initialPage: { products, total: 31, page: 1, hasMore: true },
  });
  assert.match(html, /aria-pressed="true"[^>]*>All</, "All is the selected chip");
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1, "only one chip is selected");
  assert.match(html, /Newest on PackAM · 31 items/);
  assert.match(html, />Show more</);
  assert.match(html, /Showing 24 of 31/);
  assert.doesNotMatch(html, /Start typing/, "All never shows an empty prompt instead of products");
});

test("a category with no products offers a way back to everything", () => {
  const html = page({
    query: "",
    category: "food-drinks",
    categories: [{ name: "Food & Drinks", slug: "food-drinks" }],
    initialPage: { products: [], total: 0, page: 1, hasMore: false },
  });
  assert.match(html, /No food &amp; drinks listed yet/);
  assert.match(html, />Browse everything</);
  assert.match(html, /aria-pressed="true"[^>]*><span aria-hidden="true">[^<]*<\/span>Food &amp; Drinks/);
});
