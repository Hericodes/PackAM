import { parseShopInput } from "../../../../../lib/food/admin-input";
import { createFoodShop } from "../../../../../lib/food/admin-store";
import { readJson, requireFoodAdmin } from "../route-helpers";

export async function POST(request: Request) {
  const admin = await requireFoodAdmin();
  if ("response" in admin) return admin.response;
  const input = parseShopInput(await readJson(request), true);
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  try {
    const result = await createFoodShop(admin.adminId, input.data);
    return result.ok ? Response.json(result.data, { status: 201 }) : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("FOOD SHOP CREATE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The shop couldn’t be saved. Nothing was changed." }, { status: 500 });
  }
}
