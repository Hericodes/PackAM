import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "../../../auth";
import { db } from "../../../lib/db";
import { writeAuditLog } from "../../../lib/audit";
import { consumeRateLimit } from "../../../lib/rate-limit";
import { isPackamProductImageUrl } from "../../../lib/cloudinary-url";
import { isProductRequestId } from "../../../lib/products/product-form";
import { verifyProductImageForSave } from "../../../lib/products/product-image-server";
import { canManageCatalogue, isValidCustomerPrice } from "../../../lib/catalogue-permissions";

// Only admins manage the catalogue. Runners report shop prices through order sourcing instead.
const canManageProducts = canManageCatalogue;

// Includes vendor contacts and sourcing prices, so it is limited to catalogue managers.
export async function GET() {
  const session = await auth();
  if (!session?.user || !canManageProducts(session.user.role)) {
    return NextResponse.json({ error: "You are not authorized to view catalogue sourcing data." }, { status: 403 });
  }
  const products = await db.product.findMany({
    take: 200,
    include: {
      category: true,
      sources: {
        include: {
          vendor: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return NextResponse.json(products);
}

export async function POST(request: Request) {
  let attemptId: string | undefined;
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

    const body = await request.json();

    const {
      name,
      description,
      imageUrl,
      categoryId,
      customerPrice,
      status = "ACTIVE",
      requestId,
    } = body;

    // One id per "Add product" attempt, chosen by the form. A retried request (double tap, flaky network)
    // finds the product it already created instead of creating a second one.
    if (requestId !== undefined && !isProductRequestId(requestId)) {
      return NextResponse.json({ error: "Invalid request. Reload the page and try again." }, { status: 400 });
    }
    attemptId = requestId;
    if (requestId) {
      const already = await db.product.findUnique({ where: { id: requestId }, include: { category: true } });
      if (already) return NextResponse.json({ ...already, replayed: true }, { status: 200 });
    }

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof categoryId !== "string" ||
      !categoryId ||
      !isValidCustomerPrice(customerPrice) ||
      name.trim().length > 120 ||
      (description !== undefined && description !== null && (typeof description !== "string" || description.length > 2000))
    ) {
      return NextResponse.json(
        {
          error:
            "Name, category and a customer price of at least ₦1 are required.",
        },
        { status: 400 },
      );
    }

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

    if (typeof imageUrl === "string" && !isPackamProductImageUrl(imageUrl, process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME)) return NextResponse.json({ error: "Choose a PackAM product image." }, { status: 400 });
    if (typeof imageUrl === "string" && imageUrl.trim()) {
      const image = await verifyProductImageForSave(imageUrl.trim());
      if (!image.ok) return NextResponse.json({ error: image.error }, { status: image.status });
    }

    const slug = await createUniqueSlug(name);

    const product = await db.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        ...(requestId ? { id: requestId } : {}),
        name: name.trim(),
        slug,
        description:
          typeof description === "string" && description.trim()
            ? description.trim()
            : null,
        imageUrl:
          typeof imageUrl === "string" && imageUrl.trim()
            ? imageUrl.trim()
            : null,
        categoryId,
        customerPrice,
        status: status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      },
      include: {
        category: true,
      },
    });

    await writeAuditLog(tx, { actorId: session.user.id, action: "PRODUCT_CREATED", resource: "Product", resourceId: created.id, newState: { name: created.name, categoryId: created.categoryId, customerPrice: created.customerPrice, status: created.status } });
    return created;
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    // Two copies of the same request raced: the other one created the product, so return it.
    const retried = await replayedProduct(error, attemptId);
    if (retried) return NextResponse.json({ ...retried, replayed: true }, { status: 200 });
    console.error("CREATE PRODUCT ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return NextResponse.json(
      { error: "Something went wrong while creating the product." },
      { status: 500 },
    );
  }
}

async function replayedProduct(error: unknown, requestId: string | undefined) {
  if (!requestId || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  try {
    return await db.product.findUnique({ where: { id: requestId }, include: { category: true } });
  } catch {
    return null;
  }
}

async function createUniqueSlug(name: string) {
  const baseSlug =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "product";

  let slug = baseSlug;
  let counter = 2;

  while (
    await db.product.findUnique({
      where: {
        slug,
      },
      select: {
        id: true,
      },
    })
  ) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}
