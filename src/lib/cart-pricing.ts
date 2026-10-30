import "server-only";

import type { Prisma } from "@prisma/client";
import { CHECKOUT_DELIVERY_FEE } from "./checkout-pricing";
import { cartContext, isMixedCart, type CartContext } from "./food/cart-context";
import { priceLine, storedLineRequest, type FoodRole, type LineDetails, type MenuItem } from "./food/plate";
import { isDedicatedWorkflowCategory } from "./products/catalogue";
import { stockShortfall, type VariantDetails } from "./products/variants";

type Reader = Pick<Prisma.TransactionClient, "cart" | "product" | "vendor">;

export type PricedCartLine = {
  cartItemId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  category: string;
  quantity: number;
  /** Server price for one unit: the product price, or base + soup + extras for a plate. */
  unitPrice: number;
  total: number;
  /** Food: the meal or plate as priced now. A product with options: the chosen variant's options. */
  details: LineDetails | VariantDetails | null;
  variantId: string | null;
  /** Why this line can't be bought right now, or null. */
  problem: string | null;
  configKey: string;
};

export type PricedCart = {
  cartId: string | null;
  context: CartContext;
  /** The food shop, when the cart is a food order. */
  shop: { id: string; name: string; isOpen: boolean } | null;
  lines: PricedCartLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  count: number;
  /** Everything that stops checkout, in plain words. Empty when the cart can be paid for. */
  problems: string[];
};

const EMPTY: PricedCart = { cartId: null, context: { kind: "empty" }, shop: null, lines: [], subtotal: 0, deliveryFee: 0, total: 0, count: 0, problems: [] };


/**
 * Prices the student's cart from the database as it is right now. Order Stuff lines use the product's
 * current price; food lines are re-priced against the shop's current menu (base + soup + extras).
 * Nothing the browser sent is used. Lines that can't be bought are reported, never silently dropped.
 */
export async function priceCart(reader: Reader, userId: string): Promise<PricedCart> {
  const cart = await reader.cart.findUnique({
    where: { userId },
    select: {
      id: true,
      items: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, quantity: true, configKey: true, productId: true, variantId: true,
          product: { select: { id: true, name: true, imageUrl: true, customerPrice: true, status: true, stockQuantity: true, shopId: true, foodRole: true, shop: { select: { name: true } }, category: { select: { name: true, slug: true, isActive: true } }, _count: { select: { variants: { where: { status: "ACTIVE" } } } } } },
          variant: { select: { id: true, price: true, stockQuantity: true, status: true, sku: true, imageUrl: true, values: { select: { optionValue: { select: { value: true, option: { select: { name: true, position: true } } } } } } } },
          extras: { select: { productId: true, quantity: true, product: { select: { foodRole: true } } } },
        },
      },
    },
  });
  if (!cart?.items.length) return { ...EMPTY, cartId: cart?.id ?? null };

  const context = cartContext(cart.items);
  const problems: string[] = [];
  if (isMixedCart(cart.items)) problems.push("Your cart mixes food with other items or with another shop. Remove items so it holds one kind of order.");

  // Food: the shop and its whole current menu, read once.
  let shop: PricedCart["shop"] = null;
  let menu: MenuItem[] = [];
  if (context.kind === "food") {
    const found = await reader.vendor.findUnique({ where: { id: context.shopId }, select: { id: true, name: true, isOpen: true, listedInFood: true, status: true } });
    const listed = Boolean(found && found.listedInFood && found.status === "ACTIVE");
    shop = found ? { id: found.id, name: found.name, isOpen: listed && found.isOpen } : null;
    if (!listed) problems.push(`${context.shopName} isn’t taking orders on PackAM right now.`);
    else if (!found!.isOpen) problems.push(`${found!.name} is closed right now, so it can’t take new orders.`);
    const items = await reader.product.findMany({ where: { shopId: context.shopId }, select: { id: true, name: true, foodRole: true, customerPrice: true, status: true, maxPerPlate: true } });
    menu = items.filter((item) => item.foodRole).map((item) => ({
      id: item.id, name: item.name, role: item.foodRole as FoodRole, price: item.customerPrice,
      available: item.status === "ACTIVE" && item.customerPrice >= 1, maxPerPlate: item.maxPerPlate,
    }));
  }

  const lines = cart.items.map((item): PricedCartLine => {
    const base = { cartItemId: item.id, productId: item.productId, name: item.product.name, imageUrl: item.variant?.imageUrl ?? item.product.imageUrl, category: item.product.category.name, quantity: item.quantity, configKey: item.configKey, variantId: item.variantId };
    if (item.product.shopId) {
      if (context.kind === "food" && item.product.shopId !== context.shopId) {
        return { ...base, unitPrice: 0, total: 0, details: null, problem: "From a different shop." };
      }
      const priced = priceLine(menu, storedLineRequest({
        productId: item.productId, quantity: item.quantity, productRole: item.product.foodRole as FoodRole | null,
        extras: item.extras.map((extra) => ({ productId: extra.productId, quantity: extra.quantity, role: extra.product.foodRole as FoodRole | null })),
      }));
      if (!priced.ok) return { ...base, unitPrice: 0, total: 0, details: null, problem: priced.error };
      return { ...base, unitPrice: priced.line.unitPrice, total: priced.line.total, details: priced.line.details, problem: null };
    }
    const product = item.product;
    const sellable = product.status === "ACTIVE" && product.customerPrice >= 1 && product.category.isActive && !isDedicatedWorkflowCategory(product.category.slug);
    if (!sellable) return { ...base, unitPrice: 0, total: 0, details: null, problem: `${product.name} is no longer available.` };
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) return { ...base, unitPrice: product.customerPrice, total: 0, details: null, problem: "This item has an invalid quantity." };

    // A product with options: the chosen variant's own price, availability and stock.
    if (item.variant) {
      const variant = item.variant;
      const details: VariantDetails = {
        kind: "VARIANT", variantId: variant.id, sku: variant.sku,
        options: [...variant.values].sort((a, b) => a.optionValue.option.position - b.optionValue.option.position).map((value) => ({ name: value.optionValue.option.name, value: value.optionValue.value })),
      };
      if (variant.status !== "ACTIVE") return { ...base, unitPrice: 0, total: 0, details, problem: "This option is no longer available." };
      const stockProblem = stockShortfall(variant.stockQuantity, item.quantity);
      return { ...base, unitPrice: variant.price, total: variant.price * item.quantity, details, problem: stockProblem };
    }
    // Added before the product had options: the student needs to choose them now.
    if (product._count.variants > 0) return { ...base, unitPrice: 0, total: 0, details: null, problem: "Choose this item’s options again: it now comes in different options." };
    return { ...base, unitPrice: product.customerPrice, total: product.customerPrice * item.quantity, details: null, problem: stockShortfall(product.stockQuantity, item.quantity) };
  });

  for (const line of lines) if (line.problem) problems.push(line.problem.startsWith(line.name) ? line.problem : `${line.name}: ${line.problem}`);
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const deliveryFee = CHECKOUT_DELIVERY_FEE;
  return {
    cartId: cart.id,
    context,
    shop,
    lines,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    problems: [...new Set(problems)],
  };
}
