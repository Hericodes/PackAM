import { searchProducts } from "../../../lib/products/search";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../lib/db-errors";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await searchProducts({
      query: url.searchParams.get("q") ?? "",
      category: url.searchParams.get("category") ?? "",
      subcategory: url.searchParams.get("sub") ?? "",
      label: url.searchParams.get("label") ?? "",
      page: Number(url.searchParams.get("page") ?? 1),
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "GET /api/search");
    console.error("PRODUCT SEARCH ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Search is temporarily unavailable." }, { status: 500 });
  }
}
