import "server-only";

import { db } from "../db";
import { isDedicatedWorkflowCategory, studentCatalogueProductWhere } from "./catalogue";
import { productCardSelect, toProductCard, type ProductCardData } from "./card";
import { MARKETPLACE_PAGE_SIZE, MAX_RANKED_RESULTS, marketplacePage, rankProducts, searchTerms, type MarketplacePage } from "./marketplace";

export { searchTerms };

export type ProductSearchResult = ProductCardData;

export type SearchInput = {
  query: string;
  category: string;
  /** A subcategory slug within the chosen category. */
  subcategory?: string;
  /** A label slug, e.g. "popular". */
  label?: string;
  page?: number;
};

/**
 * The single marketplace query used by both the /search page and /api/search, so server-rendered and
 * live results always agree. Only products students may see are ever returned (studentCatalogueProductWhere).
 *
 * - No search and no category ("All"): every visible product, newest first.
 * - A category (optionally narrowed to a subcategory): that group's visible products, A–Z.
 * - A label narrows any of these to products carrying it.
 * - A search: best matches first, matching names, descriptions, categories, subcategories and labels.
 * Each is paged, so nothing beyond the first page is ever out of reach.
 */
export async function searchProducts(input: SearchInput): Promise<MarketplacePage<ProductSearchResult>> {
  const query = input.query.trim().slice(0, 100);
  const category = input.category.trim().slice(0, 100);
  const subcategory = (input.subcategory ?? "").trim().slice(0, 100);
  const label = (input.label ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const terms = searchTerms(query);
  // Printing is browsed through its own workflow, never as catalogue items.
  if (isDedicatedWorkflowCategory(category)) return marketplacePage([], 0, page);

  const where = {
    ...studentCatalogueProductWhere,
    category: { ...studentCatalogueProductWhere.category, ...(category ? { slug: category } : {}) },
    ...(category && subcategory ? { subcategory: { slug: subcategory, isActive: true } } : {}),
    ...(label ? { labels: { some: { label: { slug: label, isActive: true } } } } : {}),
    ...(terms.length ? { OR: terms.flatMap((term) => [
      { name: { contains: term, mode: "insensitive" as const } },
      { description: { contains: term, mode: "insensitive" as const } },
      { category: { name: { contains: term, mode: "insensitive" as const } } },
      { subcategory: { name: { contains: term, mode: "insensitive" as const }, isActive: true } },
      { labels: { some: { label: { name: { contains: term, mode: "insensitive" as const }, isActive: true } } } },
    ]) } : {}),
  };

  if (!terms.length) {
    // Browsing: the database pages it. A stable tie-breaker means no product repeats or goes missing across pages.
    const orderBy = category ? [{ name: "asc" as const }, { id: "asc" as const }] : [{ createdAt: "desc" as const }, { id: "asc" as const }];
    const [total, products] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({ where, select: productCardSelect, orderBy, skip: (page - 1) * MARKETPLACE_PAGE_SIZE, take: MARKETPLACE_PAGE_SIZE }),
    ]);
    return marketplacePage(products.map(toProductCard), total, page);
  }

  // Searching: rank the matches, then page the ranked list.
  const matches = await db.product.findMany({ where, select: { ...productCardSelect, description: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: MAX_RANKED_RESULTS });
  const ranked = rankProducts(matches, query, terms).map(toProductCard);
  const start = (page - 1) * MARKETPLACE_PAGE_SIZE;
  return marketplacePage(ranked.slice(start, start + MARKETPLACE_PAGE_SIZE), ranked.length, page);
}
