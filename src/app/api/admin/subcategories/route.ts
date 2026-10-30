import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { parseNamedInput } from "../../../../lib/products/catalogue-admin";
import { isDedicatedWorkflowCategory } from "../../../../lib/products/catalogue";
import { isUniqueClash, readJson, requireCatalogueAdmin } from "../../../../lib/products/catalogue-route-helpers";

export async function POST(request: Request) {
  const admin = await requireCatalogueAdmin();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  const categoryId = body && typeof body === "object" ? (body as { categoryId?: unknown }).categoryId : undefined;
  if (typeof categoryId !== "string" || !categoryId) return Response.json({ error: "Choose the parent category." }, { status: 400 });
  const input = parseNamedInput(body, { creating: true, kind: "Subcategory" });
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  const category = await db.category.findUnique({ where: { id: categoryId }, select: { id: true, slug: true } });
  if (!category) return Response.json({ error: "That category doesn’t exist." }, { status: 400 });
  if (isDedicatedWorkflowCategory(category.slug)) return Response.json({ error: "Food and Printing have their own workflows and don’t use subcategories." }, { status: 400 });
  try {
    const subcategory = await db.$transaction(async (tx) => {
      const created = await tx.subcategory.create({
        data: { categoryId, name: input.data.name!, slug: input.data.slug!, description: input.data.description ?? null, sortOrder: input.data.sortOrder ?? 0 },
        select: { id: true, name: true, slug: true },
      });
      await writeAuditLog(tx, { actorId: admin.adminId, action: "SUBCATEGORY_CREATED", resource: "Subcategory", resourceId: created.id, newState: { ...created, categoryId } });
      return created;
    });
    return Response.json({ subcategory }, { status: 201 });
  } catch (error) {
    if (isUniqueClash(error)) return Response.json({ error: `“${input.data.name}” already exists in this category.` }, { status: 409 });
    throw error;
  }
}
