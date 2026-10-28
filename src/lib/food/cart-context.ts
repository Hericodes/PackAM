/**
 * Food and Order Stuff are separate checkouts. A cart holds Order Stuff items, or food from one shop,
 * never a mix. Pure, so the boundary is unit-tested; the cart API enforces it on the server.
 */

export type CartContext = { kind: "empty" } | { kind: "stuff" } | { kind: "food"; shopId: string; shopName: string };

export function cartContext(items: Array<{ product: { shopId: string | null; shop?: { name: string } | null } }>): CartContext {
  if (!items.length) return { kind: "empty" };
  const food = items.find((item) => item.product.shopId);
  if (!food) return { kind: "stuff" };
  return { kind: "food", shopId: food.product.shopId!, shopName: food.product.shop?.name ?? "a food shop" };
}

/** True if the cart holds food from more than one shop, or food with Order Stuff (never created, but checked). */
export function isMixedCart(items: Array<{ product: { shopId: string | null } }>) {
  const shops = new Set(items.map((item) => item.product.shopId ?? "stuff"));
  return shops.size > 1;
}

export type CartConflict = { code: "CART_CONTEXT"; current: CartContext; message: string };

/**
 * Whether something can be added. `target` is the food shop being added from, or null for Order Stuff.
 * A conflict is never resolved here: the student chooses to finish their checkout or clear the cart.
 */
export function addConflict(current: CartContext, target: { shopId: string; shopName: string } | null): CartConflict | null {
  if (current.kind === "empty") return null;
  if (target === null) {
    if (current.kind === "stuff") return null;
    return { code: "CART_CONTEXT", current, message: `Your cart has food from ${current.shopName}. Food and other items are checked out separately: finish that order first, or clear your cart to add this.` };
  }
  if (current.kind === "food" && current.shopId === target.shopId) return null;
  if (current.kind === "food") return { code: "CART_CONTEXT", current, message: `Your cart has food from ${current.shopName}. One food order comes from one shop: finish that order first, or clear your cart to order from ${target.shopName}.` };
  return { code: "CART_CONTEXT", current, message: `Your cart has items from Order Stuff. Food is checked out separately: finish that order first, or clear your cart to order from ${target.shopName}.` };
}
