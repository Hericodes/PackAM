import { parseShopInput } from "../../../../../../lib/food/admin-input";
import { updateFoodShop } from "../../../../../../lib/food/admin-store";
import { isToggleOnly, readJson, requireFoodAdmin } from "../../route-helpers";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await readJson(request);
  const admin = await requireFoodAdmin(isToggleOnly(body, ["isOpen", "listedInFood"]) ? "visibility" : "edit");
  if ("response" in admin) return admin.response;
  const { id } = await context.params;
  const input = parseShopInput(body, false);
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  try {
    const result = await updateFoodShop(admin.adminId, id, input.data);
    return result.ok ? Response.json(result.data) : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("FOOD SHOP UPDATE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The shop couldn’t be saved. Nothing was changed." }, { status: 500 });
  }
}
