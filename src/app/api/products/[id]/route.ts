import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { isPackamProductImageUrl } from "../../../../lib/cloudinary-url";

const allowedRoles = ["RUNNER", "ADMIN"] as const;

function canManageProducts(role?: string) {
  return role && allowedRoles.includes(role as (typeof allowedRoles)[number]);
}

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
        { error: "You are not authorized to manage products." },
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
      (typeof name !== "string" || !name.trim())
    ) {
      return NextResponse.json(
        { error: "Product name cannot be empty." },
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
      customerPrice !== undefined &&
      (typeof customerPrice !== "number" || !Number.isSafeInteger(customerPrice) || customerPrice < 0)
    ) {
      return NextResponse.json(
        { error: "Invalid customer price." },
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
          customerPrice: Math.round(customerPrice),
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
    console.error("UPDATE PRODUCT ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return NextResponse.json(
      { error: "Something went wrong while updating the product." },
      { status: 500 },
    );
  }
}
