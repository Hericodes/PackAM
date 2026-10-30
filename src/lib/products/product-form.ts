/**
 * Rules for the admin product form. Pure, so validation, request ids and "add another" are unit-tested.
 */

/** A product create attempt's id: 32 lowercase hex characters. It becomes the new product's id. */
export function isProductRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export function newProductRequestId() {
  return crypto.randomUUID().replaceAll("-", "");
}

export type ProductDraft = {
  name: string;
  categoryId: string;
  /** What the admin typed in the ₦ field. */
  price: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
  imageUrl: string;
  /** "" for none. Must belong to the chosen category (checked on the server too). */
  subcategoryId: string;
  labelIds: string[];
  /** What the admin typed for stock: "" means not tracked. */
  stock: string;
  /** Products with options are priced and stocked per variant. */
  hasVariants?: boolean;
};

export type ProductDraftField = "name" | "categoryId" | "price" | "description" | "stock";
export type ProductDraftErrors = Partial<Record<ProductDraftField, string>>;

export const PRODUCT_NAME_MAX = 120;
export const PRODUCT_DESCRIPTION_MAX = 2000;

/** A whole-naira amount typed by an admin: "1500", "1,500" or "₦1,500". Null when empty. */
export function parseNairaInput(text: string): number | null | "invalid" {
  const cleaned = text.replace(/[₦,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+$/.test(cleaned)) return "invalid";
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : "invalid";
}

/**
 * Field-by-field problems, in form order. A new product always needs a real price (the API requires it).
 * An existing product may have no price yet (₦0, stored for products added before pricing), but only
 * while inactive: the same rule the API and the database enforce.
 */
export function validateProductDraft(draft: ProductDraft, isEditing: boolean): ProductDraftErrors {
  const errors: ProductDraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Enter the product name.";
  else if (name.length > PRODUCT_NAME_MAX) errors.name = `Keep the name under ${PRODUCT_NAME_MAX} characters.`;
  if (!draft.categoryId) errors.categoryId = "Choose a category.";
  const price = parseNairaInput(draft.price);
  if (price === "invalid") errors.price = "Enter the price in whole naira, like 1500.";
  else if (price !== null && price < 1) errors.price = "The price must be at least ₦1.";
  else if (price === null && !isEditing) errors.price = "Enter the selling price.";
  else if (price === null && draft.status === "ACTIVE") errors.price = "Set a price before making this product visible to students.";
  if (draft.description.trim().length > PRODUCT_DESCRIPTION_MAX) errors.description = `Keep the description under ${PRODUCT_DESCRIPTION_MAX} characters.`;
  if (!draft.hasVariants && draft.stock.trim() && parseStock(draft.stock) === "invalid") errors.stock = "Stock must be a whole number of 0 or more, or blank if you don’t track it.";
  return errors;
}

/** Stock as typed: "" is not tracked (null), otherwise a whole number of 0 or more. */
export function parseStock(text: string): number | null | "invalid" {
  const cleaned = text.trim().replace(/,/g, "");
  if (!cleaned) return null;
  if (!/^\d+$/.test(cleaned)) return "invalid";
  const value = Number(cleaned);
  return Number.isSafeInteger(value) && value <= 1_000_000 ? value : "invalid";
}

/** The request body for the products API. */
export function productDraftPayload(draft: ProductDraft) {
  const price = parseNairaInput(draft.price);
  const stock = parseStock(draft.stock);
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    imageUrl: draft.imageUrl,
    categoryId: draft.categoryId,
    ...(typeof price === "number" && !draft.hasVariants ? { customerPrice: price } : {}),
    status: draft.status,
    subcategoryId: draft.subcategoryId || null,
    labelIds: draft.labelIds,
    ...(draft.hasVariants ? {} : { stockQuantity: stock === "invalid" ? null : stock }),
  };
}

/** After "Add another product": keep the category, subcategory and visibility; clear the rest. */
export function nextDraftAfterCreate(previous: ProductDraft): ProductDraft {
  return { name: "", categoryId: previous.categoryId, subcategoryId: previous.subcategoryId, price: "", description: "", status: previous.status, imageUrl: "", labelIds: [], stock: "" };
}

export function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}
