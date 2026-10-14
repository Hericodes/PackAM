/**
 * Catalogue rules shared by every route that creates or changes products.
 *
 * Only admins manage the catalogue: names, categories, images, status and the customer price.
 * Runners report what a shop actually charges through order sourcing, which records the vendor
 * price on ProductSource and never changes Product.customerPrice or a paid order's amount.
 */
export function canManageCatalogue(role: string | null | undefined) {
  return role === "ADMIN";
}

/** A customer-facing price must be a whole, positive naira amount. ₦0 would let checkout charge delivery only. */
export function isValidCustomerPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** A shop price reported while sourcing must also be a real, positive amount. */
export function isValidReportedShopPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
