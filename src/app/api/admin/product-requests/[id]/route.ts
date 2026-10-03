import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit";

type Context = { params: Promise<{ id: string }> };
const transitions: Record<string, string[]> = { PENDING: ["CHECKING"], CHECKING: ["AVAILABLE", "UNAVAILABLE"] };

export async function PATCH(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid request." }, { status: 400 });
  const input = body as { status?: unknown; productId?: unknown };
  if (typeof input.status !== "string" || !["CHECKING", "AVAILABLE", "UNAVAILABLE"].includes(input.status) || (input.productId !== undefined && input.productId !== null && typeof input.productId !== "string")) return Response.json({ error: "Choose a valid request status." }, { status: 400 });
  try {
    const result = await db.$transaction(async (tx) => {
      const item = await tx.productRequest.findUnique({ where: { id }, select: { id: true, userId: true, status: true, requestedName: true, productId: true } });
      if (!item) throw new Error("REQUEST_NOT_FOUND");
      if (!transitions[item.status]?.includes(input.status as string) && !(item.status === input.status && (input.status !== "AVAILABLE" || !!(input.productId || item.productId)))) throw new Error("INVALID_REQUEST_TRANSITION");
      const productId = input.status === "AVAILABLE" ? (typeof input.productId === "string" ? input.productId : item.productId) : null;
      if (input.status === "AVAILABLE" && !productId) throw new Error("SELECT_PRODUCT");
      if (productId) {
        const product = await tx.product.findFirst({ where: { id: productId, status: "ACTIVE" }, select: { id: true } });
        if (!product) throw new Error("PRODUCT_NOT_FOUND");
      }
      const changed = await tx.productRequest.updateMany({ where: { id, status: item.status }, data: { status: input.status as "CHECKING" | "AVAILABLE" | "UNAVAILABLE", productId } });
      if (changed.count !== 1) throw new Error("REQUEST_CHANGED");
      if (item.status !== input.status) {
        const message = input.status === "CHECKING" ? "We’re checking around for the product you requested 👀" : input.status === "AVAILABLE" ? "We found the product you requested 👀" : "We couldn’t find that product this time.";
        await tx.notification.createMany({ data: [{ userId: item.userId, type: "PRODUCT_REQUEST", title: input.status === "AVAILABLE" ? "Product found" : input.status === "UNAVAILABLE" ? "Request update" : "We’re checking", message, relatedType: "PRODUCT_REQUEST", relatedId: id, idempotencyKey: `product-request-status:${id}:${input.status}` }], skipDuplicates: true });
        await writeAuditLog(tx, { actorId: session.user.id, action: "PRODUCT_REQUEST_STATUS_CHANGED", resource: "ProductRequest", resourceId: id, previousState: { status: item.status, productId: item.productId }, newState: { status: input.status as string, productId } });
      }
      return tx.productRequest.findUnique({ where: { id }, select: { id: true, requestedName: true, status: true, productId: true, product: { select: { id: true, name: true } } } });
    });
    return Response.json({ request: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "REQUEST_NOT_FOUND" || message === "PRODUCT_NOT_FOUND" ? 404 : message === "SELECT_PRODUCT" || message === "INVALID_REQUEST_TRANSITION" ? 409 : 400;
    console.error("ADMIN PRODUCT REQUEST UPDATE ERROR:", message || "Unknown error");
    return Response.json({ error: status === 404 ? "Request or active product not found." : status === 409 ? message === "SELECT_PRODUCT" ? "Select a catalogue product before marking this request found." : "This request cannot move to that status." : "Unable to update the request." }, { status });
  }
}
