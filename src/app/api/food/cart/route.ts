import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { addToCart, cartConflictResponse } from "../../../../lib/cart-add";
import { priceCart } from "../../../../lib/cart-pricing";
import { priceLine, type LineRequest, type MenuItem } from "../../../../lib/food/plate";
import { listedShopWhere } from "../../../../lib/food/shops";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../../lib/db-errors";

/**
 * Adds a ready-made meal or a built plate to the student's cart. The browser sends only ids and
 * quantities: the shop's open status, every item's availability and all prices are checked and worked
 * out here from the database.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Log in to order food." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only students can order food." }, { status: 403 });

  let body: { shopId?: unknown; line?: unknown; clearCart?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (typeof body?.shopId !== "string" || !body.shopId || body.shopId.length > 100 || !body.line || typeof body.line !== "object") {
    return Response.json({ error: "Choose a meal from a food shop." }, { status: 400 });
  }

  try {
    const shop = await db.vendor.findFirst({ where: { id: body.shopId, ...listedShopWhere }, select: { id: true, name: true, isOpen: true } });
    if (!shop) return Response.json({ error: "This shop isn’t on PackAM Food right now." }, { status: 404 });
    if (!shop.isOpen) return Response.json({ error: `${shop.name} is closed right now, so it can’t take new orders.`, code: "SHOP_CLOSED" }, { status: 409 });

    const items = await db.product.findMany({ where: { shopId: shop.id, foodRole: { not: null } }, select: { id: true, name: true, foodRole: true, customerPrice: true, status: true, maxPerPlate: true } });
    const menu: MenuItem[] = items.map((item) => ({ id: item.id, name: item.name, role: item.foodRole!, price: item.customerPrice, available: item.status === "ACTIVE" && item.customerPrice >= 1, maxPerPlate: item.maxPerPlate }));
    const priced = priceLine(menu, body.line as LineRequest);
    if (!priced.ok) return Response.json({ error: priced.error }, { status: 400 });

    const result = await addToCart(session.user.id, {
      shop: { id: shop.id, name: shop.name },
      productId: priced.line.productId,
      configKey: priced.line.configKey,
      extras: priced.line.extras,
      quantity: priced.line.quantity,
    }, body.clearCart === true);
    if (!result.ok) return "conflict" in result ? cartConflictResponse(result.conflict) : Response.json({ error: result.error }, { status: 400 });

    const cart = await priceCart(db, session.user.id);
    return Response.json({ added: { name: priced.line.name, unitPrice: priced.line.unitPrice, quantity: priced.line.quantity }, cleared: result.cleared, summary: { count: cart.count, subtotal: cart.subtotal } });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "POST /api/food/cart");
    console.error("FOOD CART ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t add that to your cart. Please try again." }, { status: 500 });
  }
}
