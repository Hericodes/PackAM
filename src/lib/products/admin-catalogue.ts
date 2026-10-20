import type { Prisma } from "@prisma/client";

/**
 * The admin product list query. Ordering happens in the database, so active products come before
 * inactive ones across every page and filter combination, not just within the visible page.
 * Postgres sorts an enum by declaration order, and ProductStatus declares ACTIVE before INACTIVE.
 */
export const ADMIN_PRODUCTS_PAGE_SIZE = 50;

export const ADMIN_PRODUCT_ORDER_BY: Prisma.ProductOrderByWithRelationInput[] = [
  { status: "asc" },
  { updatedAt: "desc" },
  // Stable tie-breaker so paging never skips or repeats a product.
  { id: "asc" },
];

export type AdminProductFilters = { q: string; categoryId: string; status: "" | "ACTIVE" | "INACTIVE"; page: number };

export function parseAdminProductFilters(params: Record<string, string | string[] | undefined>): AdminProductFilters {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const status = one(params.status);
  return {
    q: one(params.q).trim().slice(0, 100),
    categoryId: one(params.category).trim().slice(0, 100),
    status: status === "ACTIVE" || status === "INACTIVE" ? status : "",
    page: Math.max(1, Math.floor(Number(one(params.page))) || 1),
  };
}

export function adminProductWhere(filters: AdminProductFilters): Prisma.ProductWhereInput {
  return {
    ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" as const } } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
}

/** Builds a list URL that keeps the current filters, so paging never drops a search. */
export function adminProductsHref(filters: Partial<AdminProductFilters>) {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.categoryId) query.set("category", filters.categoryId);
  if (filters.status) query.set("status", filters.status);
  if (filters.page && filters.page > 1) query.set("page", String(filters.page));
  return `/admin/products${query.size ? `?${query}` : ""}`;
}

export type ProductDeletionFacts = {
  status: "ACTIVE" | "INACTIVE";
  orderItems: number;
  /** Unfinished marketplace checkouts whose saved snapshot includes this product. */
  openCheckouts: number;
};

/**
 * Whether a product may be permanently deleted. Only a product that is already inactive and has no
 * order history or open checkout qualifies; anything else stays in the catalogue as INACTIVE, which
 * already hides it from students while keeping every historical record intact.
 */
export function productDeletionBlocker(facts: ProductDeletionFacts): string | null {
  if (facts.orderItems > 0) {
    return `This product appears in ${facts.orderItems} past order ${facts.orderItems === 1 ? "item" : "items"}, so it can’t be deleted without breaking order history. Keep it inactive instead — students can’t see or buy inactive products.`;
  }
  if (facts.openCheckouts > 0) {
    return "A student has an unfinished payment that includes this product. Deleting it now could stop that payment from becoming an order. Try again once the payment has completed or failed.";
  }
  if (facts.status !== "INACTIVE") {
    return "Deactivate this product first. Deleting is only allowed for inactive products, so a student can’t be checking out with it while it’s removed.";
  }
  return null;
}
