/**
 * What students can see and buy in the marketplace.
 *
 * Printing is a dedicated workflow (upload → configure → pay → print). Products filed under the
 * printing category must never be sold as ordinary cart items, because that would bypass document
 * upload, page pricing and secure fulfilment. They stay in the database untouched; they are simply
 * not part of the student catalogue.
 */
/** Categories with their own student flow, never listed or sold through Order Stuff. */
export const DEDICATED_WORKFLOW_CATEGORY_SLUGS = ["printing", "food"] as const;
/** Every food shop's menu item is filed under this category (created on first use in Admin → Food). */
export const FOOD_CATEGORY = { name: "Food", slug: "food" } as const;

export function isDedicatedWorkflowCategory(slug: string | null | undefined) {
  return typeof slug === "string" && (DEDICATED_WORKFLOW_CATEGORY_SLUGS as readonly string[]).includes(slug);
}

/** Prisma `where` for products a student may browse, open and add to a cart. */
export const studentCatalogueProductWhere = {
  status: "ACTIVE" as const,
  // Food menu items belong to a shop and are only ever sold through /food, one shop per order.
  shopId: null,
  // Never show or sell a product whose price hasn't been set (stored as ₦0), even if it were ACTIVE.
  customerPrice: { gte: 1 },
  category: { isActive: true, slug: { notIn: [...DEDICATED_WORKFLOW_CATEGORY_SLUGS] } },
};

/** Prisma `where` for categories shown as marketplace filters. */
export const studentCatalogueCategoryWhere = {
  isActive: true,
  slug: { notIn: [...DEDICATED_WORKFLOW_CATEGORY_SLUGS] },
};

/** Flat delivery fee per order, shown wherever students see prices. Mirrors checkout-pricing. */
export { CHECKOUT_DELIVERY_FEE as STUDENT_DELIVERY_FEE } from "../checkout-pricing";
