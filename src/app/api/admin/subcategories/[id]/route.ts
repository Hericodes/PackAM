import { db } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit";
import { parseNamedInput } from "../../../../../lib/products/catalogue-admin";
import { isUniqueClash, readJson, requireCatalogueAdmin } from "../../../../../lib/products/catalogue-route-helpers";

/** Rename, describe, reorder, hide or show a subcategory. It always stays in its category. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireCatalogueAdmin();
  if ("response" in admin) return admin.response;
  const { id } = await context.params;
  const input = parseNamedInput(await readJson(request), { creating: false, kind: "Subcategory" });
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  const before = await db.subcategory.findUnique({ where: { id }, select: { name: true, isActive: true, sortOrder: true } });
  if (!before) return Response.json({ error: "Subcategory not found." }, { status: 404 });
  try {
    const subcategory = await db.$transaction(async (tx) => {
      const updated = await tx.subcategory.update({ where: { id }, data: input.data, select: { id: true, name: true, slug: true, isActive: true, sortOrder: true } });
      await writeAuditLog(tx, { actorId: admin.adminId, action: "SUBCATEGORY_UPDATED", resource: "Subcategory", resourceId: id, previousState: before, newState: updated });
      return updated;
    });
    return Response.json({ subcategory });
  } catch (error) {
    if (isUniqueClash(error)) return Response.json({ error: `“${input.data.name}” already exists in this category.` }, { status: 409 });
    throw error;
  }
}
