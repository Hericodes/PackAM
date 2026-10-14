import "server-only";

import { db } from "../db";

export type ProductSearchResult = {
  id: string;
  name: string;
  customerPrice: number;
  imageUrl: string | null;
  category: { name: string };
};

export function searchTerms(query: string) {
  return [...new Set(query.toLocaleLowerCase().split(/\s+/).filter((term) => term.length >= 2))].slice(0, 8);
}

/**
 * The single product search used by both the /search page and /api/search, so server-rendered
 * results and live results always agree. A category with no query lists that category.
 */
export async function searchProducts(input: { query: string; category: string }): Promise<ProductSearchResult[]> {
  const query = input.query.trim().slice(0, 100);
  const category = input.category.trim().slice(0, 100);
  const terms = searchTerms(query);
  if (!terms.length && !category) return [];

  const products = await db.product.findMany({
    where: {
      status: "ACTIVE",
      category: { isActive: true, ...(category ? { slug: category } : {}) },
      ...(terms.length ? { OR: terms.flatMap((term) => [
        { name: { contains: term, mode: "insensitive" as const } },
        { description: { contains: term, mode: "insensitive" as const } },
        { category: { name: { contains: term, mode: "insensitive" as const } } },
      ]) } : {}),
    },
    select: { id: true, name: true, description: true, customerPrice: true, imageUrl: true, category: { select: { name: true } } },
    orderBy: terms.length ? { createdAt: "desc" } : { name: "asc" },
    take: terms.length ? 80 : 48,
  });

  const normalized = query.toLocaleLowerCase();
  const scored = products.map((product) => {
    const name = product.name.toLocaleLowerCase();
    const description = (product.description ?? "").toLocaleLowerCase();
    const categoryName = product.category.name.toLocaleLowerCase();
    const score = !terms.length ? 0 : (name === normalized ? 100 : name.startsWith(normalized) ? 70 : name.includes(normalized) ? 55 : 0)
      + terms.reduce((total, term) => total + (name.includes(term) ? 12 : 0) + (description.includes(term) ? 5 : 0) + (categoryName.includes(term) ? 4 : 0), 0);
    return { product, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .slice(0, 24)
    .map(({ product }) => ({ id: product.id, name: product.name, customerPrice: product.customerPrice, imageUrl: product.imageUrl, category: product.category }));
}
