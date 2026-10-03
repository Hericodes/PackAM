import { ProductAvailability } from "@prisma/client";
import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { consumeRateLimit } from "../../../../lib/rate-limit";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-source:${session.user.id}`, 60, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many source changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "Choose a product and shop." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Choose a product and shop." }, { status: 400 });
  const input = body as { productId?: unknown; vendorId?: unknown; currentPrice?: unknown; availability?: unknown };
  if (typeof input.productId !== "string" || typeof input.vendorId !== "string" || !Object.values(ProductAvailability).includes(input.availability as ProductAvailability)) return Response.json({ error: "Choose a product, shop, and availability." }, { status: 400 });
  const price = input.currentPrice === "" || input.currentPrice === null || input.currentPrice === undefined ? null : Number(input.currentPrice);
  if (price !== null && (!Number.isSafeInteger(price) || price < 0)) return Response.json({ error: "Enter a valid whole-naira price." }, { status: 400 });
  try {
    const source = await db.$transaction(async (tx) => {
      const existing = await tx.productSource.findUnique({ where: { productId_vendorId: { productId: input.productId as string, vendorId: input.vendorId as string } }, select: { id: true, currentPrice: true, availability: true } });
      const item = await tx.productSource.upsert({ where: { productId_vendorId: { productId: input.productId as string, vendorId: input.vendorId as string } }, create: { productId: input.productId as string, vendorId: input.vendorId as string, currentPrice: price, availability: input.availability as ProductAvailability }, update: { currentPrice: price, availability: input.availability as ProductAvailability }, select: { id: true, currentPrice: true, availability: true } });
      await writeAuditLog(tx, { actorId: session.user.id, action: existing ? "PRODUCT_SOURCE_UPDATED" : "PRODUCT_SOURCE_CREATED", resource: "ProductSource", resourceId: item.id, previousState: existing ?? undefined, newState: item });
      if (price !== null && (!existing || existing.currentPrice !== price)) await tx.priceRecord.create({ data: { productSourceId: item.id, price } });
      if (!existing || existing.availability !== item.availability) await tx.availabilityRecord.create({ data: { productSourceId: item.id, availability: item.availability } });
      return item;
    });
    return Response.json({ source }, { status: 201 });
  } catch { return Response.json({ error: "Choose an existing product and shop." }, { status: 400 }); }
}
