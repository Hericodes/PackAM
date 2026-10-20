import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { isPackamProductImageUrl } from "../../../../lib/cloudinary-url";
import { activationBlocker, canManageCatalogue, isValidCustomerPrice } from "../../../../lib/catalogue-permissions";
import { deleteProductAsAdmin } from "../../../../lib/products/product-deletion";

// Only admins manage the catalogue. Runners report shop prices through order sourcing instead.
const canManageProducts = canManageCatalogue;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    // Includes vendor contacts and sourcing prices, so it is limited to catalogue managers.
    const session = await auth();
    if (!session?.user || !canManageProducts(session.user.role)) {
      return NextResponse.json({ error: "You are not authorized to view catalogue sourcing data." }, { status: 403 });
    }
    const { id } = await context.params;

    const product = await db.product.findUnique({
      where: {
        id,
      },
      include: {
        category: true,
        sources: {
          include: {
            vendor: true,
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(product);
  } catch (error) {
    console.error("GET PRODUCT ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return NextResponse.json(
      { error: "Unable to fetch product." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const session = await auth();

    if (!session?.user || !canManageProducts(session.user.role)) {
      return NextResponse.json(
        { error: "Only PackAM admins can change the catalogue." },
        { status: 403 },
      );
    }
    const rate = await consumeRateLimit(`product-write:${session.user.id}`, 30, 60 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ error: "Product changes are temporarily rate limited." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

    const { id } = await context.params;
    const body = await request.json();

    const existingProduct = await db.product.findUnique({
      where: {
        id,
      },
    });

    if (!existingProduct) {
      return NextResponse.json(
        { error: "Product not found." },
        { status: 404 },
      );
    }

    const {
      name,
      description,
      imageUrl,
      categoryId,
      customerPrice,
      status,
    } = body;

    if (
      name !== undefined &&
      (typeof name !== "string" || !name.trim() || name.trim().length > 120)
    ) {
      return NextResponse.json(
        { error: "Product name must be 1–120 characters." },
        { status: 400 },
      );
    }

    if (
      categoryId !== undefined &&
      typeof categoryId !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid category." },
        { status: 400 },
      );
    }

    if (
      customerPrice !== undefined && !isValidCustomerPrice(customerPrice)
    ) {
      return NextResponse.json(
        { error: "Customer price must be a whole amount of at least ₦1." },
        { status: 400 },
      );
    }

    if (categoryId) {
      const category = await db.category.findUnique({
        where: {
          id: categoryId,
        },
      });

      if (!category) {
        return NextResponse.json(
          { error: "Selected category does not exist." },
          { status: 400 },
        );
      }
    }

    if (imageUrl !== undefined && typeof imageUrl === "string" && !isPackamProductImageUrl(imageUrl, process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME)) return NextResponse.json({ error: "Choose a PackAM product image." }, { status: 400 });

    const product = await db.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id }, select: { name: true, categoryId: true, customerPrice: true, status: true, updatedAt: true } });
    if (!before) throw new Error("PRODUCT_CHANGED");
    // A product whose price hasn't been set (₦0) can be edited and given photos, but never sold.
    const finalStatus = status === "ACTIVE" || status === "INACTIVE" ? status : before.status;
    const finalPrice = customerPrice !== undefined ? customerPrice : before.customerPrice;
    if (finalStatus === "ACTIVE" && activationBlocker(finalPrice)) throw new Error("PRICE_REQUIRED");
    const changed = await tx.product.updateMany({
      where: {
        id,
        updatedAt: before.updatedAt,
      },
      data: {
        ...(name !== undefined && {
          name: name.trim(),
        }),

        ...(description !== undefined && {
          description:
            typeof description === "string" && description.trim()
              ? description.trim()
              : null,
        }),

        ...(imageUrl !== undefined && {
          imageUrl:
            typeof imageUrl === "string" && imageUrl.trim()
              ? imageUrl.trim()
              : null,
        }),

        ...(categoryId !== undefined && {
          categoryId,
        }),

        ...(customerPrice !== undefined && {
          customerPrice,
        }),

        ...(status === "ACTIVE" || status === "INACTIVE"
          ? { status }
          : {}),
      },
    });
    if (changed.count !== 1) throw new Error("PRODUCT_CHANGED");
    const updated = await tx.product.findUnique({ where: { id }, include: { category: true } });
    if (!updated) throw new Error("PRODUCT_CHANGED");
    await writeAuditLog(tx, { actorId: session.user.id, action: "PRODUCT_UPDATED", resource: "Product", resourceId: id, previousState: { name: before.name, categoryId: before.categoryId, customerPrice: before.customerPrice, status: before.status }, newState: { name: updated.name, categoryId: updated.categoryId, customerPrice: updated.customerPrice, status: updated.status } });
    return updated;
    }, { isolationLevel: "Serializable" });

    return NextResponse.json(product);
  } catch (error) {
    if (error instanceof Error && error.message === "PRICE_REQUIRED") {
      return NextResponse.json({ error: activationBlocker(0) }, { status: 400 });
    }
    console.error("UPDATE PRODUCT ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return NextResponse.json(
      { error: "Something went wrong while updating the product." },
      { status: 500 },
    );
  }
}

/**
 * Permanently deletes a product only when that is safe (inactive, never ordered, in no open checkout).
 * Otherwise responds 409 with the reason; the admin keeps the product INACTIVE instead.
 */
export async function DELETE(
  _request: Request,
  context: RouteContext,
) {
  try {
    const session = await auth();
    if (!session?.user || !canManageProducts(session.user.role)) {
      return NextResponse.json({ error: "Only PackAM admins can delete products." }, { status: 403 });
    }
    const rate = await consumeRateLimit(`product-write:${session.user.id}`, 30, 60 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ error: "Product changes are temporarily rate limited." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

    const { id } = await context.params;
    if (!id || id.length > 100) return NextResponse.json({ error: "Product not found." }, { status: 404 });
    const result = await deleteProductAsAdmin(session.user.id, id);
    if (result.kind === "NOT_FOUND") return NextResponse.json({ error: "Product not found. It may already have been deleted." }, { status: 404 });
    if (result.kind === "BLOCKED") return NextResponse.json({ error: result.reason }, { status: 409 });
    return NextResponse.json({ deleted: true, name: result.name, removedFromCarts: result.removedFromCarts });
  } catch (error) {
    console.error("DELETE PRODUCT ERROR:", (error instanceof Error ? error.name : "Unknown error"));
    return NextResponse.json({ error: "The product couldn’t be deleted. Nothing was changed — please try again." }, { status: 500 });
  }
}
