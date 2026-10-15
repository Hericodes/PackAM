/**
 * Saved products live on the student's device (localStorage). There is no favourites table, and
 * adding one would need a schema change, so the UI always says "saved on this device".
 * Only product IDs are stored; prices and availability are always read fresh from the server.
 */
export const SAVED_PRODUCTS_KEY = "packam:saved-products:v1";
export const SAVED_PRODUCTS_LIMIT = 100;
export const SAVED_PRODUCTS_EVENT = "packam:saved-products-changed";

const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseSavedProductIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && VALID_ID.test(entry) && !ids.includes(entry)) ids.push(entry);
    if (ids.length >= SAVED_PRODUCTS_LIMIT) break;
  }
  return ids;
}

/** Newest first; saving again moves nothing, unsaving removes it. */
export function toggleSavedProductId(ids: readonly string[], id: string): { ids: string[]; saved: boolean } {
  if (!VALID_ID.test(id)) return { ids: [...ids], saved: false };
  if (ids.includes(id)) return { ids: ids.filter((entry) => entry !== id), saved: false };
  return { ids: [id, ...ids].slice(0, SAVED_PRODUCTS_LIMIT), saved: true };
}
