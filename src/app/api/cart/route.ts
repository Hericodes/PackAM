import { auth } from "../../../auth";
import { db } from "../../../lib/db";

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

function summarizeCart(cart: { items: { quantity: number; product: { customerPrice: number } }[] } | null) {
  return (cart?.items ?? []).reduce((summary, item) => ({
    count: summary.count + item.quantity,
    subtotal: summary.subtotal + item.quantity * item.product.customerPrice,
  }), { count: 0, subtotal: 0 });
}

async function getCartSummary(userId: string) {
  const cart = await db.cart.findUnique({
    where: { userId },
    select: { items: { select: { quantity: true, product: { select: { customerPrice: true } } } } },
  });
  return summarizeCart(cart);
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
      summary: summarizeCart(cart),
    });
  } catch (error) {
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
      select: { id: true },
      where: {
        id: productId,
        status: "ACTIVE",
        category: {
          isActive: true,
        },
      },
    });

    if (!product) {
      return Response.json(
        { error: "This product is no longer available." },
        { status: 404 },
      );
    }

    const cart = await db.cart.upsert({
      where: {
        userId: session.user.id,
      },
      create: {
        userId: session.user.id,
      },
      update: {},
    });

    const existingItem = await db.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
    });

    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;

      if (newQuantity > 99) {
        return Response.json(
          { error: "You can add a maximum of 99 units of one product." },
          { status: 400 },
        );
      }

      await db.cartItem.update({
        where: {
          id: existingItem.id,
        },
        data: {
          quantity: newQuantity,
        },
      });
    } else {
      await db.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          quantity,
        },
      });
    }

    return Response.json({ message: "Product added to cart.", summary: await getCartSummary(session.user.id) });
  } catch (error) {
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
    console.error("REMOVE CART ITEM ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return Response.json(
      { error: "Unable to remove this item." },
      { status: 500 },
    );
  }
}

