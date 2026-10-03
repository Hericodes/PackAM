import { db } from "../../../lib/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const category = (url.searchParams.get("category") ?? "").trim().slice(0, 100);
  if (!query && !category) return Response.json({ products: [] });
  const terms = [...new Set(query.toLocaleLowerCase().split(/\s+/).filter((term) => term.length >= 2))].slice(0, 8);
  if (!terms.length) return Response.json({ products: [] });

  try {
    const products = await db.product.findMany({
      where: {
        status: "ACTIVE",
        category: { isActive: true, ...(category ? { slug: category } : {}) },
        ...(terms.length ? { OR: terms.flatMap((term) => [
          { name: { contains: term, mode: "insensitive" as const } },
          { description: { contains: term, mode: "insensitive" as const } },
          { category: { name: { contains: term, mode: "insensitive" as const } } },
        ]) } : {}),
      },
      select: { id: true, name: true, description: true, customerPrice: true, imageUrl: true, category: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: terms.length ? 80 : 24,
    });
    const normalized = query.toLocaleLowerCase();
    const ranked = products.map((product) => {
      const name = product.name.toLocaleLowerCase();
      const description = (product.description ?? "").toLocaleLowerCase();
      const categoryName = product.category.name.toLocaleLowerCase();
      const score = (name === normalized ? 100 : name.startsWith(normalized) ? 70 : name.includes(normalized) ? 55 : 0)
        + terms.reduce((total, term) => total + (name.includes(term) ? 12 : 0) + (description.includes(term) ? 5 : 0) + (categoryName.includes(term) ? 4 : 0), 0);
      return { product, score };
    }).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name)).slice(0, 24).map(({ product }) => ({
      id: product.id, name: product.name, customerPrice: product.customerPrice, imageUrl: product.imageUrl, category: product.category,
    }));
    return Response.json({ products: ranked }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("PRODUCT SEARCH ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Search is temporarily unavailable." }, { status: 500 });
  }
}
