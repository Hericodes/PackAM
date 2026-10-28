import { db } from "../../../../../../lib/db";
import { parseMenuItemInput } from "../../../../../../lib/food/admin-input";
import { updateMenuItem } from "../../../../../../lib/food/admin-store";
import type { FoodRole } from "../../../../../../lib/food/plate";
import { isToggleOnly, readJson, requireFoodAdmin } from "../../route-helpers";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await readJson(request);
  const admin = await requireFoodAdmin(isToggleOnly(body, ["available"]) ? "visibility" : "edit");
  if ("response" in admin) return admin.response;
  const { id } = await context.params;
  const existing = await db.product.findUnique({ where: { id }, select: { foodRole: true } });
  if (!existing?.foodRole) return Response.json({ error: "Menu item not found." }, { status: 404 });
  const input = parseMenuItemInput(body, false, existing.foodRole as FoodRole);
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  try {
    const result = await updateMenuItem(admin.adminId, id, input.data);
    return result.ok ? Response.json(result.data) : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("FOOD ITEM UPDATE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The item couldn’t be saved. Nothing was changed." }, { status: 500 });
  }
}
