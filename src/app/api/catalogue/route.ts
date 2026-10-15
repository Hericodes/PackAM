import { db } from "../../../lib/db";
import { studentCatalogueProductWhere } from "../../../lib/products/catalogue";
import { parseSavedProductIds } from "../../../lib/saved-products";

/**
 * Public, read-only lookup of catalogue products by id (used by "Saved on this device").
 * Returns only what a student already sees on a product card; hidden or unknown ids are omitted.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = parseSavedProductIds(JSON.stringify(raw.split(",").slice(0, 100)));
  if (!ids.length) return Response.json({ products: [] }, { headers: { "Cache-Control": "private, no-store" } });
  try {
    const products = await db.product.findMany({
      where: { id: { in: ids }, ...studentCatalogueProductWhere },
      select: { id: true, name: true, customerPrice: true, imageUrl: true, category: { select: { name: true } } },
      take: 100,
    });
    return Response.json({ products }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("CATALOGUE LOOKUP ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Saved items couldn’t load. Try again." }, { status: 500 });
  }
}
