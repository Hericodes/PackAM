import { auth } from "../../../auth";
import { db } from "../../../lib/db";
import { notifyAdmins } from "../../../lib/notifications";
import { consumeRateLimit } from "../../../lib/rate-limit";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to view support requests." }, { status: 401 });
  const where = session.user.role === "ADMIN" ? {} : { userId: session.user.id };
  const cases = await db.supportCase.findMany({ where, orderBy: { createdAt: "desc" }, take: session.user.role === "ADMIN" ? 100 : 50, select: { id: true, subject: true, description: true, status: true, resolution: true, orderId: true, createdAt: true, updatedAt: true, ...(session.user.role === "ADMIN" ? { user: { select: { id: true, firstName: true, lastName: true, email: true } } } : {}) } });
  return Response.json({ cases });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to contact PackAM." }, { status: 401 });
  if (session.user.role === "ADMIN") return Response.json({ error: "Use the operations support queue." }, { status: 403 });
  const rate = await consumeRateLimit(`support:${session.user.id}`, 5, 60 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Please wait before sending another support request." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Please check your support request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Please check your support request." }, { status: 400 });
  const input = body as { subject?: unknown; description?: unknown; orderId?: unknown };
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (subject.length < 4 || subject.length > 120 || description.length < 10 || description.length > 3000 || (input.orderId !== undefined && input.orderId !== null && typeof input.orderId !== "string")) return Response.json({ error: "Add a short subject and a little more detail." }, { status: 400 });
  try {
    const result = await db.$transaction(async (tx) => {
      if (typeof input.orderId === "string") {
        const allowed = session.user.role === "STUDENT"
          ? await tx.order.findFirst({ where: { id: input.orderId, userId: session.user.id }, select: { id: true } })
          : await tx.order.findFirst({ where: { id: input.orderId, assignments: { some: { runner: { userId: session.user.id }, status: "ACCEPTED" } } }, select: { id: true } });
        if (!allowed) throw new Error("ORDER_NOT_FOUND");
      }
      const supportCase = await tx.supportCase.create({ data: { userId: session.user.id, subject, description, orderId: typeof input.orderId === "string" ? input.orderId : null }, select: { id: true, subject: true, status: true, createdAt: true } });
      await notifyAdmins(tx, { type: "SYSTEM", title: "Support request needs review", message: `A student submitted support case ${supportCase.id}: ${subject}`, orderId: typeof input.orderId === "string" ? input.orderId : null, relatedType: "SUPPORT_CASE", relatedId: supportCase.id, idempotencyKey: `support-created:${supportCase.id}` });
      return supportCase;
    });
    return Response.json({ case: result }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") return Response.json({ error: "We couldn't find that order." }, { status: 404 });
    console.error("SUPPORT SUBMISSION ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn't send your request. Please try again." }, { status: 500 });
  }
}
