import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { db } from "../../../lib/db";
import { writeAuditLog } from "../../../lib/audit";
import { consumeRateLimit } from "../../../lib/rate-limit";
import { isPackamProductImageUrl } from "../../../lib/cloudinary-url";
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
    } = body;

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

    const slug = await createUniqueSlug(name);

    const product = await db.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
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
    console.error("CREATE PRODUCT ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return NextResponse.json(
      { error: "Something went wrong while creating the product." },
      { status: 500 },
    );
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
