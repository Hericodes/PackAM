import { searchProducts } from "../../../lib/products/search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await searchProducts({
      query: url.searchParams.get("q") ?? "",
      category: url.searchParams.get("category") ?? "",
      page: Number(url.searchParams.get("page") ?? 1),
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("PRODUCT SEARCH ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Search is temporarily unavailable." }, { status: 500 });
  }
}
