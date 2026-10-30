import { readJson, requireCatalogueAdmin } from "../../../../../../lib/products/catalogue-route-helpers";
import { loadVariantSetup, saveVariantSetup } from "../../../../../../lib/products/variant-store";
import { parseVariantSetup } from "../../../../../../lib/products/variants";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const admin = await requireCatalogueAdmin();
  if ("response" in admin) return admin.response;
  const setup = await loadVariantSetup((await context.params).id);
  return setup ? Response.json(setup, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Product not found." }, { status: 404 });
}

/** Saves the product's whole option and variant setup at once (empty = a simple product). */
export async function PUT(request: Request, context: Context) {
  const admin = await requireCatalogueAdmin();
  if ("response" in admin) return admin.response;
  const parsed = parseVariantSetup(await readJson(request));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const result = await saveVariantSetup(admin.adminId, (await context.params).id, parsed.data);
    return result.ok ? Response.json({ saved: true, variants: result.variantCount }) : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("VARIANT SAVE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The options couldn’t be saved. Nothing was changed — try again." }, { status: 500 });
  }
}
