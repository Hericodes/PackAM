import "server-only";

import { db } from "../db";
import { isDedicatedWorkflowCategory, studentCatalogueProductWhere } from "./catalogue";
import { MARKETPLACE_PAGE_SIZE, MAX_RANKED_RESULTS, marketplacePage, rankProducts, searchTerms, type MarketplacePage } from "./marketplace";

export { searchTerms };

export type ProductSearchResult = {
  id: string;
  name: string;
  customerPrice: number;
  imageUrl: string | null;
  category: { name: string };
};

const select = { id: true, name: true, customerPrice: true, imageUrl: true, category: { select: { name: true } } } as const;

/**
 * The single marketplace query used by both the /search page and /api/search, so server-rendered and
 * live results always agree. Only products students may see are ever returned (studentCatalogueProductWhere).
 *
 * - No search and no category ("All"): every visible product, newest first.
 * - A category: that category's visible products, A–Z.
 * - A search (optionally within a category): best matches first.
 * Each is paged, so nothing beyond the first page is ever out of reach.
 */
export async function searchProducts(input: { query: string; category: string; page?: number }): Promise<MarketplacePage<ProductSearchResult>> {
  const query = input.query.trim().slice(0, 100);
  const category = input.category.trim().slice(0, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const terms = searchTerms(query);
  // Printing is browsed through its own workflow, never as catalogue items.
  if (isDedicatedWorkflowCategory(category)) return marketplacePage([], 0, page);

  const where = {
    ...studentCatalogueProductWhere,
    category: { ...studentCatalogueProductWhere.category, ...(category ? { slug: category } : {}) },
    ...(terms.length ? { OR: terms.flatMap((term) => [
      { name: { contains: term, mode: "insensitive" as const } },
      { description: { contains: term, mode: "insensitive" as const } },
      { category: { name: { contains: term, mode: "insensitive" as const } } },
    ]) } : {}),
  };

  if (!terms.length) {
    // Browsing: the database pages it. A stable tie-breaker means no product repeats or goes missing across pages.
    const orderBy = category ? [{ name: "asc" as const }, { id: "asc" as const }] : [{ createdAt: "desc" as const }, { id: "asc" as const }];
    const [total, products] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({ where, select, orderBy, skip: (page - 1) * MARKETPLACE_PAGE_SIZE, take: MARKETPLACE_PAGE_SIZE }),
    ]);
    return marketplacePage(products, total, page);
  }

  // Searching: rank the matches, then page the ranked list.
  const matches = await db.product.findMany({ where, select: { ...select, description: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: MAX_RANKED_RESULTS });
  const ranked = rankProducts(matches, query, terms).map(({ id, name, customerPrice, imageUrl, category: productCategory }) => ({ id, name, customerPrice, imageUrl, category: productCategory }));
  const start = (page - 1) * MARKETPLACE_PAGE_SIZE;
  return marketplacePage(ranked.slice(start, start + MARKETPLACE_PAGE_SIZE), ranked.length, page);
}
