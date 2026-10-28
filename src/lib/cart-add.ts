import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { retrySerializable } from "./db-retry";
import { addConflict, cartContext, type CartConflict } from "./food/cart-context";

export type CartAddition = {
  /** The food shop the line comes from, or null for an Order Stuff product. */
  shop: { id: string; name: string } | null;
  productId: string;
  /** "" for a product as it is; the plate key for a built plate. */
  configKey: string;
  /** A built plate's soup and extras (empty otherwise). */
  extras: Array<{ productId: string; quantity: number }>;
  quantity: number;
};

export type CartAddResult = { ok: true; cleared: boolean } | { ok: false; conflict: CartConflict } | { ok: false; error: string };

/**
 * Adds one line to the student's cart, in one serializable transaction:
 * - a cart holds Order Stuff or food from one shop; anything else is a conflict, never merged;
 * - the cart is emptied only when the student explicitly chose to clear it (`clearCart`);
 * - an identical line (same product and, for plates, the same choices) gets its quantity raised, up to 99;
 *   a different plate on the same base becomes its own line.
 * Validation of the product or plate itself happens before this, on the server.
 */
export async function addToCart(userId: string, addition: CartAddition, clearCart: boolean): Promise<CartAddResult> {
  return retrySerializable(() => db.$transaction(async (tx) => {
    const cart = await tx.cart.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
    const items = await tx.cartItem.findMany({ where: { cartId: cart.id }, select: { product: { select: { shopId: true, shop: { select: { name: true } } } } } });
    const conflict = addConflict(cartContext(items), addition.shop ? { shopId: addition.shop.id, shopName: addition.shop.name } : null);
    let cleared = false;
    if (conflict) {
      if (!clearCart) return { ok: false as const, conflict };
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      cleared = true;
    }

    const existing = await tx.cartItem.findUnique({
      where: { cartId_productId_configKey: { cartId: cart.id, productId: addition.productId, configKey: addition.configKey } },
      select: { id: true, quantity: true },
    });
    if (existing) {
      const quantity = existing.quantity + addition.quantity;
      if (quantity > 99) return { ok: false as const, error: "You can add a maximum of 99 of one item." };
      await tx.cartItem.update({ where: { id: existing.id }, data: { quantity } });
    } else {
      await tx.cartItem.create({
        data: {
          cartId: cart.id,
          productId: addition.productId,
          configKey: addition.configKey,
          quantity: addition.quantity,
          ...(addition.extras.length ? { extras: { create: addition.extras.map((extra) => ({ productId: extra.productId, quantity: extra.quantity })) } } : {}),
        },
      });
    }
    return { ok: true as const, cleared };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

/** The 409 body every cart route returns for a cart conflict, so the browser can offer the two choices. */
export function cartConflictResponse(conflict: CartConflict) {
  const current = conflict.current;
  return Response.json({
    error: conflict.message,
    code: conflict.code,
    current: current.kind === "food" ? { kind: "food", shopId: current.shopId, shopName: current.shopName } : { kind: current.kind },
  }, { status: 409 });
}
