import { db } from "../../lib/db";
import { LiveSearch } from "../../components/student/LiveSearch";
import { StudentNavbar } from "../../components/student/StudentNavbar";
import { searchProducts, searchTerms } from "../../lib/products/search";

type SearchPageProps = { searchParams: Promise<{ q?: string; category?: string }> };

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 100);
  const category = params.category ?? "";
  const browseOnly = !searchTerms(query).length && !category;
  const [categories, products] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    browseOnly
      ? db.product.findMany({
          where: { status: "ACTIVE", category: { isActive: true } },
          select: { id: true, name: true, customerPrice: true, imageUrl: true, category: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 24,
        })
      : searchProducts({ query, category }),
  ]);

  return (
    <main className="min-h-screen bg-[#fffdf7]">
      <StudentNavbar />
      <div className="packam-container py-6 sm:py-10">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-black/50">Campus marketplace</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-4xl">Find what you need</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-black/60 sm:text-base">
          Search across campus essentials, or browse a category to get started.
        </p>
        <LiveSearch key={`${query}:${category}`} query={query} category={category} categories={categories} initialProducts={products} />
      </div>
    </main>
  );
}
