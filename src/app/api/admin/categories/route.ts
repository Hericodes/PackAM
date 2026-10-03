import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { consumeRateLimit } from "../../../../lib/rate-limit";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-category:${session.user.id}`, 40, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many category changes." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Enter a category name." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Enter a category name." }, { status: 400 });
  const input = body as { name?: unknown; description?: unknown };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!name || name.length > 80 || description.length > 300) return Response.json({ error: "Check the category name and description." }, { status: 400 });
  const slug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return Response.json({ error: "Use a category name with letters or numbers." }, { status: 400 });
  try {
    const category = await db.$transaction(async (tx) => {
      const created = await tx.category.create({ data: { name, slug, description: description || null }, select: { id: true, name: true, slug: true, isActive: true } });
      await writeAuditLog(tx, { actorId: session.user.id, action: "CATEGORY_CREATED", resource: "Category", resourceId: created.id, newState: created });
      return created;
    });
    return Response.json({ category }, { status: 201 });
  } catch { return Response.json({ error: "That category name may already exist." }, { status: 409 }); }
}
