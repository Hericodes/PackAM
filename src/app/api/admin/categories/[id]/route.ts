import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-category:${session.user.id}`, 40, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many category changes." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid category changes." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid category changes." }, { status: 400 });
  const input = body as { isActive?: unknown; name?: unknown; description?: unknown };
  const data: { isActive?: boolean; name?: string; description?: string | null } = {};
  if (input.isActive !== undefined) { if (typeof input.isActive !== "boolean") return Response.json({ error: "Invalid category status." }, { status: 400 }); data.isActive = input.isActive; }
  if (input.name !== undefined) { if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80) return Response.json({ error: "Invalid category name." }, { status: 400 }); data.name = input.name.trim(); }
  if (input.description !== undefined) { if (typeof input.description !== "string") return Response.json({ error: "Invalid category description." }, { status: 400 }); data.description = input.description.trim().slice(0, 300) || null; }
  if (!Object.keys(data).length) return Response.json({ error: "No valid category changes." }, { status: 400 });
  try {
    const category = await db.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id }, select: { name: true, slug: true, description: true, isActive: true, updatedAt: true } });
      if (!before) throw new Error("NOT_FOUND");
      const changed = await tx.category.updateMany({ where: { id, updatedAt: before.updatedAt }, data });
      if (changed.count !== 1) throw new Error("CONFLICT");
      const updated = await tx.category.findUnique({ where: { id }, select: { id: true, name: true, slug: true, description: true, isActive: true } });
      if (!updated) throw new Error("NOT_FOUND");
      await writeAuditLog(tx, { actorId: session.user.id, action: "CATEGORY_UPDATED", resource: "Category", resourceId: id, previousState: { name: before.name, slug: before.slug, description: before.description, isActive: before.isActive }, newState: updated });
      return updated;
    }, { isolationLevel: "Serializable" });
    return Response.json({ category });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return Response.json({ error: code === "CONFLICT" ? "This category changed while you were editing it." : "Category not found or update failed." }, { status: code === "CONFLICT" ? 409 : 404 });
  }
}
