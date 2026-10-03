import { ProductAvailability } from "@prisma/client";
import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-source:${session.user.id}`, 60, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many source changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "Invalid source details." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid source details." }, { status: 400 });
  const input = body as { currentPrice?: unknown; availability?: unknown };
  const price = input.currentPrice === undefined ? undefined : input.currentPrice === null || input.currentPrice === "" ? null : Number(input.currentPrice);
  if (price !== undefined && price !== null && (!Number.isSafeInteger(price) || price < 0)) return Response.json({ error: "Enter a valid whole-naira price." }, { status: 400 });
  if (input.availability !== undefined && !Object.values(ProductAvailability).includes(input.availability as ProductAvailability)) return Response.json({ error: "Choose a valid availability." }, { status: 400 });
  if (price === undefined && input.availability === undefined) return Response.json({ error: "No source changes provided." }, { status: 400 });
  try {
    const source = await db.$transaction(async (tx) => {
      const before = await tx.productSource.findUnique({ where: { id }, select: { currentPrice: true, availability: true } });
      if (!before) throw new Error("SOURCE_NOT_FOUND");
      const source = await tx.productSource.update({ where: { id }, data: { ...(price !== undefined ? { currentPrice: price } : {}), ...(input.availability !== undefined ? { availability: input.availability as ProductAvailability } : {}) }, select: { id: true, currentPrice: true, availability: true } });
      if (price !== undefined && price !== before.currentPrice && price !== null) await tx.priceRecord.create({ data: { productSourceId: id, price } });
      if (source.availability !== before.availability) await tx.availabilityRecord.create({ data: { productSourceId: id, availability: source.availability } });
      await writeAuditLog(tx, { actorId: session.user.id, action: "PRODUCT_SOURCE_UPDATED", resource: "ProductSource", resourceId: id, previousState: before, newState: source });
      return source;
    });
    return Response.json({ source });
  } catch { return Response.json({ error: "Product source not found." }, { status: 404 }); }
}
