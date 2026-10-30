import { auth } from "../../../auth";
import { db } from "../../../lib/db";
import { studentCatalogueProductWhere } from "../../../lib/products/catalogue";
import { priceCart } from "../../../lib/cart-pricing";
import { addToCart, cartConflictResponse } from "../../../lib/cart-add";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../lib/db-errors";
import { variantConfigKey } from "../../../lib/products/variants";

async function getStudentCart(userId: string) {
  return db.cart.findUnique({
    where: {
      userId,
    },
    include: {
      items: {
        include: {
          product: {
            include: {
              category: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

/** Count and subtotal priced on the server (plates include their soup and extras). */
async function getCartSummary(userId: string) {
  const priced = await priceCart(db, userId);
  return { count: priced.count, subtotal: priced.subtotal };
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return Response.json(
        { error: "You must be logged in." },
        { status: 401 },
      );
    }

    if (session.user.role !== "STUDENT") {
      return Response.json(
        { error: "Only students can access the cart." },
        { status: 403 },
      );
    }

    const cart = await getStudentCart(session.user.id);

    return Response.json({
      cart,
      summary: await getCartSummary(session.user.id),
    });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "GET /api/cart");
    console.error("GET CART ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return Response.json(
      { error: "Unable to load your cart." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return Response.json(
        { error: "You must be logged in to add items to your cart." },
        { status: 401 },
      );
    }

    if (session.user.role !== "STUDENT") {
      return Response.json(
        { error: "Only students can add items to a cart." },
        { status: 403 },
      );
    }

    const body = await request.json();

    const productId = body?.productId;
    const quantity = Number(body?.quantity ?? 1);

    if (typeof productId !== "string" || !productId) {
      return Response.json(
        { error: "Product ID is required." },
        { status: 400 },
      );
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return Response.json(
        { error: "Quantity must be between 1 and 99." },
        { status: 400 },
      );
    }

    const product = await db.product.findFirst({
      select: { id: true, stockQuantity: true, _count: { select: { variants: { where: { status: "ACTIVE" } } } } },
      where: { id: productId, ...studentCatalogueProductWhere },
    });

    if (!product) {
      return Response.json(
        { error: "This product is no longer available." },
        { status: 404 },
      );
    }

    // A product with options is added as one of its variants, each its own cart line.
    const variantId = typeof body?.variantId === "string" && body.variantId ? body.variantId : null;
    let line = { configKey: "", variantId: null as string | null, stockLimit: product.stockQuantity };
    if (product._count.variants > 0 || variantId) {
      if (!variantId) return Response.json({ error: "Choose the options you want first.", code: "OPTIONS_REQUIRED" }, { status: 400 });
      const variant = await db.productVariant.findFirst({ where: { id: variantId, productId, status: "ACTIVE" }, select: { id: true, stockQuantity: true } });
      if (!variant) return Response.json({ error: "That option isn’t available. Choose another." }, { status: 409 });
      line = { configKey: variantConfigKey(variant.id), variantId: variant.id, stockLimit: variant.stockQuantity };
    }

    // Food and Order Stuff are separate checkouts. The cart is cleared only when the student chose to.
    const result = await addToCart(session.user.id, { shop: null, productId, extras: [], quantity, ...line }, body?.clearCart === true);
    if (!result.ok) return "conflict" in result ? cartConflictResponse(result.conflict) : Response.json({ error: result.error }, { status: 400 });

    return Response.json({ message: "Product added to cart.", summary: await getCartSummary(session.user.id) });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "POST /api/cart");
    console.error("ADD TO CART ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return Response.json(
      { error: "Unable to add this product to your cart." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return Response.json(
        { error: "You must be logged in." },
        { status: 401 },
      );
    }

    if (session.user.role !== "STUDENT") {
      return Response.json(
        { error: "Only students can update the cart." },
        { status: 403 },
      );
    }

    const body = await request.json();

    const itemId = body?.itemId;
    const quantity = Number(body?.quantity);

    if (typeof itemId !== "string" || !itemId) {
      return Response.json(
        { error: "Cart item ID is required." },
        { status: 400 },
      );
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return Response.json(
        { error: "Quantity must be between 1 and 99." },
        { status: 400 },
      );
    }

    const cart = await db.cart.findUnique({
      where: {
        userId: session.user.id,
      },
    });

    if (!cart) {
      return Response.json(
        { error: "Cart not found." },
        { status: 404 },
      );
    }

    const item = await db.cartItem.findFirst({
      where: {
        id: itemId,
        cartId: cart.id,
      },
    });

    if (!item) {
      return Response.json(
        { error: "Cart item not found." },
        { status: 404 },
      );
    }

    // Tracked stock: never more in the cart than is available.
    if (quantity > item.quantity) {
      const stock = item.variantId
        ? (await db.productVariant.findUnique({ where: { id: item.variantId }, select: { stockQuantity: true } }))?.stockQuantity ?? null
        : (await db.product.findUnique({ where: { id: item.productId }, select: { stockQuantity: true } }))?.stockQuantity ?? null;
      if (stock !== null && quantity > stock) {
        return Response.json({ error: stock === 0 ? "That’s out of stock right now." : `Only ${stock} left.` }, { status: 409 });
      }
    }

    await db.cartItem.update({
      where: {
        id: item.id,
      },
      data: {
        quantity,
      },
    });

    return Response.json({ message: "Cart updated.", summary: await getCartSummary(session.user.id) });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "PATCH /api/cart");
    console.error("UPDATE CART ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return Response.json(
      { error: "Unable to update your cart." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return Response.json(
        { error: "You must be logged in." },
        { status: 401 },
      );
    }

    if (session.user.role !== "STUDENT") {
      return Response.json(
        { error: "Only students can modify the cart." },
        { status: 403 },
      );
    }

    const body = await request.json();

    const itemId = body?.itemId;

    if (typeof itemId !== "string" || !itemId) {
      return Response.json(
        { error: "Cart item ID is required." },
        { status: 400 },
      );
    }

    const cart = await db.cart.findUnique({
      where: {
        userId: session.user.id,
      },
    });

    if (!cart) {
      return Response.json(
        { error: "Cart not found." },
        { status: 404 },
      );
    }

    const item = await db.cartItem.findFirst({
      where: {
        id: itemId,
        cartId: cart.id,
      },
    });

    if (!item) {
      return Response.json(
        { error: "Cart item not found." },
        { status: 404 },
      );
    }

    await db.cartItem.delete({
      where: {
        id: item.id,
      },
    });

    return Response.json({ message: "Item removed from cart.", summary: await getCartSummary(session.user.id) });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "DELETE /api/cart");
    console.error("REMOVE CART ITEM ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return Response.json(
      { error: "Unable to remove this item." },
      { status: 500 },
    );
  }
}

