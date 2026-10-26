/**
 * Marketplace listing rules shared by the server query, the API and the browser. Pure, so ranking,
 * paging, the URL and the "All" filter are unit-tested.
 */

export const MARKETPLACE_PAGE_SIZE = 24;
/** Searches rank at most this many matches; more than enough for a campus catalogue. */
export const MAX_RANKED_RESULTS = 200;

export type MarketplacePage<T> = { products: T[]; total: number; page: number; hasMore: boolean };

export function marketplacePage<T>(products: T[], total: number, page: number): MarketplacePage<T> {
  return { products, total, page, hasMore: page * MARKETPLACE_PAGE_SIZE < total };
}

export function searchTerms(query: string) {
  return [...new Set(query.toLocaleLowerCase().split(/\s+/).filter((term) => term.length >= 2))].slice(0, 8);
}

type Rankable = { id: string; name: string; description?: string | null; category: { name: string } };

/** Best matches first: exact name, then name starts with, then contains, then per-term hits. */
export function rankProducts<T extends Rankable>(products: T[], query: string, terms: string[]): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  return products
    .map((product) => {
      const name = product.name.toLocaleLowerCase();
      const description = (product.description ?? "").toLocaleLowerCase();
      const categoryName = product.category.name.toLocaleLowerCase();
      const score = (name === normalized ? 100 : name.startsWith(normalized) ? 70 : name.includes(normalized) ? 55 : 0)
        + terms.reduce((total, term) => total + (name.includes(term) ? 12 : 0) + (description.includes(term) ? 5 : 0) + (categoryName.includes(term) ? 4 : 0), 0);
      return { product, score };
    })
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name) || a.product.id.localeCompare(b.product.id))
    .map(({ product }) => product);
}

/**
 * The marketplace URL for a search and category. "All" is no category parameter at all, and the page
 * number is never kept, so changing a filter always starts again from the first page.
 */
export function marketplaceHref(query: string, category: string) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (category) params.set("category", category);
  return `/search${params.size ? `?${params}` : ""}`;
}

/** Adds the next page to what is already shown, without repeating a product that moved between pages. */
export function appendPage<T extends { id: string }>(shown: T[], next: T[]) {
  const seen = new Set(shown.map((item) => item.id));
  return [...shown, ...next.filter((item) => !seen.has(item.id))];
}
