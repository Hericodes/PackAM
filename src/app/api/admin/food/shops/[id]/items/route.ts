import { parseMenuItemInput } from "../../../../../../../lib/food/admin-input";
import { createMenuItem } from "../../../../../../../lib/food/admin-store";
import { readJson, requireFoodAdmin } from "../../../route-helpers";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireFoodAdmin();
  if ("response" in admin) return admin.response;
  const { id } = await context.params;
  const input = parseMenuItemInput(await readJson(request), true);
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  try {
    const result = await createMenuItem(admin.adminId, id, input.data);
    return result.ok ? Response.json(result.data, { status: 201 }) : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("FOOD ITEM CREATE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The item couldn’t be saved. Nothing was changed." }, { status: 500 });
  }
}
