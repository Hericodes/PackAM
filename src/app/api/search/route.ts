import { searchProducts } from "../../../lib/products/search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const products = await searchProducts({
      query: url.searchParams.get("q") ?? "",
      category: url.searchParams.get("category") ?? "",
    });
    return Response.json({ products }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("PRODUCT SEARCH ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Search is temporarily unavailable." }, { status: 500 });
  }
}
