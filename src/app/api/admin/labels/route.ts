import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { parseNamedInput } from "../../../../lib/products/catalogue-admin";
import { isUniqueClash, readJson, requireCatalogueAdmin } from "../../../../lib/products/catalogue-route-helpers";

export async function POST(request: Request) {
  const admin = await requireCatalogueAdmin();
  if ("response" in admin) return admin.response;
  const input = parseNamedInput(await readJson(request), { creating: true, kind: "Label" });
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  try {
    const label = await db.$transaction(async (tx) => {
      const created = await tx.productLabel.create({ data: { name: input.data.name!, slug: input.data.slug!, sortOrder: input.data.sortOrder ?? 0 }, select: { id: true, name: true, slug: true } });
      await writeAuditLog(tx, { actorId: admin.adminId, action: "LABEL_CREATED", resource: "ProductLabel", resourceId: created.id, newState: created });
      return created;
    });
    return Response.json({ label }, { status: 201 });
  } catch (error) {
    if (isUniqueClash(error)) return Response.json({ error: `A label called “${input.data.name}” already exists.` }, { status: 409 });
    throw error;
  }
}
