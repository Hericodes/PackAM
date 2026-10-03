import { auth } from "../../../auth";
import { db } from "../../../lib/db";
import { consumeRateLimit } from "../../../lib/rate-limit";
import { createNotification, notifyAdmins } from "../../../lib/notifications";

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to view your requests." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Student access required." }, { status: 403 });
  const requests = await db.productRequest.findMany({
    where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take: 50,
    select: { id: true, requestedName: true, quantity: true, variant: true, description: true, status: true, createdAt: true, product: { select: { id: true, name: true } } },
  });
  return Response.json({ requests });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to request a product." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Student access required." }, { status: 403 });
  const rate = await consumeRateLimit(`product-request:${session.user.id}`, 8, 60 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Please wait before sending another request." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Enter the product you need." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Enter the product you need." }, { status: 400 });
  const input = body as { productName?: unknown; quantity?: unknown; variant?: unknown; note?: unknown };
  const productName = typeof input.productName === "string" ? input.productName.trim() : "";
  const quantity = input.quantity;
  const variant = typeof input.variant === "string" ? input.variant.trim() : "";
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!productName || productName.length > 120 || !Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 99 || variant.length > 120 || note.length > 500) {
    return Response.json({ error: "Check the product name, quantity, variant, and note." }, { status: 400 });
  }
  const created = await db.$transaction(async (tx) => {
    const request = await tx.productRequest.create({
      data: { userId: session.user.id, requestedName: productName, quantity: quantity as number, variant: variant || null, description: note || null },
      select: { id: true, requestedName: true, status: true, createdAt: true },
    });
    await createNotification(tx, { userId: session.user.id, type: "PRODUCT_REQUEST", title: "Request received", message: "Got it. We’ll check around for it 👀", relatedType: "PRODUCT_REQUEST", relatedId: request.id, idempotencyKey: `product-request-received:${request.id}` });
    await notifyAdmins(tx, { type: "PRODUCT_REQUEST", title: "Product request needs review", message: `${productName} · quantity ${quantity}`, relatedType: "PRODUCT_REQUEST", relatedId: request.id, idempotencyKey: `product-request:${request.id}` });
    return request;
  });
  return Response.json({ request: created }, { status: 201 });
}
