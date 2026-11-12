/**
 * PackAM has separate carts, each with its own checkout:
 * - "stuff": Order Stuff products (anything not from a food shop), checked out at /checkout;
 * - "food": meals and plates from one food shop, checked out at /checkout/food.
 * Printing has its own flow (/printing) and never uses the cart.
 *
 * Both carts live in the student's one database cart: a line belongs to "food" when its product comes from a food
 * shop. A student can fill both at once and pay for each separately; only the food cart is limited to one shop.
 * Pure, so the boundary is unit-tested; the cart API enforces it on the server.
 */

export type CartSection = "stuff" | "food";

export const CART_SECTIONS: readonly CartSection[] = ["food", "stuff"];

/** Where each cart is checked out. */
export const CHECKOUT_PATH: Record<CartSection, string> = { stuff: "/checkout", food: "/checkout/food" };

/** What a student calls each cart. */
export const CART_SECTION_LABEL: Record<CartSection, string> = { stuff: "Shop cart", food: "Food cart" };

export function parseCartSection(value: unknown): CartSection | null {
  return value === "stuff" || value === "food" ? value : null;
}

export function sectionOf(product: { shopId: string | null }): CartSection {
  return product.shopId ? "food" : "stuff";
}

/** The lines of one cart. */
export function inSection<T extends { product: { shopId: string | null } }>(items: T[], section: CartSection): T[] {
  return items.filter((item) => sectionOf(item.product) === section);
}

export type CartContext = { kind: "empty" } | { kind: "stuff" } | { kind: "food"; shopId: string; shopName: string };

/** What one cart holds: nothing, Order Stuff, or food from a shop (the first food line's shop). */
export function cartContext(items: Array<{ product: { shopId: string | null; shop?: { name: string } | null } }>): CartContext {
  if (!items.length) return { kind: "empty" };
  const food = items.find((item) => item.product.shopId);
  if (!food) return { kind: "stuff" };
  return { kind: "food", shopId: food.product.shopId!, shopName: food.product.shop?.name ?? "a food shop" };
}

/** True if these lines hold food from more than one shop, or food with Order Stuff (never created, but checked). */
export function isMixedCart(items: Array<{ product: { shopId: string | null } }>) {
  const shops = new Set(items.map((item) => item.product.shopId ?? "stuff"));
  return shops.size > 1;
}

export type CartConflict = { code: "CART_CONTEXT"; current: CartContext; message: string };

/**
 * Whether something can be added. `foodCart` is what the food cart holds now; `target` is the food shop being added
 * from, or null for Order Stuff. Order Stuff never conflicts (it has its own cart), and food conflicts only with food
 * from another shop. A conflict is never resolved here: the student chooses to finish that order or clear the food cart.
 */
export function addConflict(foodCart: CartContext, target: { shopId: string; shopName: string } | null): CartConflict | null {
  if (target === null || foodCart.kind !== "food" || foodCart.shopId === target.shopId) return null;
  return {
    code: "CART_CONTEXT",
    current: foodCart,
    message: `Your food cart has food from ${foodCart.shopName}. One food order comes from one shop: check out that order first, or clear your food cart to order from ${target.shopName}.`,
  };
}
