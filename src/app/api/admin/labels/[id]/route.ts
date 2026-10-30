import { db } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit";
import { parseNamedInput } from "../../../../../lib/products/catalogue-admin";
import { isUniqueClash, readJson, requireCatalogueAdmin } from "../../../../../lib/products/catalogue-route-helpers";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const admin = await requireCatalogueAdmin();
  if ("response" in admin) return admin.response;
  const { id } = await context.params;
  const input = parseNamedInput(await readJson(request), { creating: false, kind: "Label" });
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  const before = await db.productLabel.findUnique({ where: { id }, select: { name: true, isActive: true, sortOrder: true } });
  if (!before) return Response.json({ error: "Label not found." }, { status: 404 });
  try {
    const label = await db.$transaction(async (tx) => {
      const updated = await tx.productLabel.update({ where: { id }, data: input.data, select: { id: true, name: true, slug: true, isActive: true, sortOrder: true } });
      await writeAuditLog(tx, { actorId: admin.adminId, action: "LABEL_UPDATED", resource: "ProductLabel", resourceId: id, previousState: before, newState: updated });
      return updated;
    });
    return Response.json({ label });
  } catch (error) {
    if (isUniqueClash(error)) return Response.json({ error: `A label called “${input.data.name}” already exists.` }, { status: 409 });
    throw error;
  }
}

/** Removes a label and takes it off every product. Labels are badges only; no order history refers to them. */
export async function DELETE(_request: Request, context: Context) {
  const admin = await requireCatalogueAdmin();
  if ("response" in admin) return admin.response;
  const { id } = await context.params;
  const label = await db.productLabel.findUnique({ where: { id }, select: { name: true, _count: { select: { products: true } } } });
  if (!label) return Response.json({ error: "Label not found." }, { status: 404 });
  await db.$transaction(async (tx) => {
    await tx.productLabel.delete({ where: { id } });
    await writeAuditLog(tx, { actorId: admin.adminId, action: "LABEL_DELETED", resource: "ProductLabel", resourceId: id, previousState: { name: label.name, products: label._count.products } });
  });
  return Response.json({ deleted: true, removedFromProducts: label._count.products });
}
