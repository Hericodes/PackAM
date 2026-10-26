/**
 * Per-admin limits on catalogue changes. They stop a runaway script or a stolen admin session from
 * rewriting the catalogue at machine speed, while leaving room for real catalogue work: a CSV import
 * can add up to 500 hidden products, which an admin then shows one by one.
 *
 * Showing or hiding a product is a one-field, reversible change, so it has its own larger budget and
 * can't be starved by edits (or vice versa). Both are fixed one-hour windows per admin.
 */
export const PRODUCT_WRITE_WINDOW_MS = 60 * 60 * 1000;

export const PRODUCT_WRITE_LIMITS = {
  /** Create, edit (name, price, photo, category, description) and delete. Was 30, shared with status changes. */
  edit: { key: "product-write", limit: 120 },
  /** Activate / deactivate only. */
  visibility: { key: "product-visibility", limit: 600 },
} as const;

/** A PATCH that changes nothing but the status: the list's Activate / Deactivate button. */
export function isVisibilityOnlyChange(body: unknown) {
  return Boolean(body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1 && "status" in body);
}

export function productWriteLimitKey(kind: keyof typeof PRODUCT_WRITE_LIMITS, adminId: string) {
  return `${PRODUCT_WRITE_LIMITS[kind].key}:${adminId}`;
}

/** What the admin sees when a limit is reached: what happened, that nothing changed, and when to retry. */
export function productLimitMessage(kind: keyof typeof PRODUCT_WRITE_LIMITS, retryAfterSeconds: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const wait = minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
  const what = kind === "visibility" ? `You’ve shown or hidden ${PRODUCT_WRITE_LIMITS.visibility.limit} products this hour` : `You’ve made ${PRODUCT_WRITE_LIMITS.edit.limit} product changes this hour`;
  return `${what}, the safety limit. Nothing was changed. Try again in ${wait}.`;
}
