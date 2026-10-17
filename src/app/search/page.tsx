import { db } from "../../lib/db";
import { LiveSearch } from "../../components/student/LiveSearch";
import { StudentNavbar } from "../../components/student/StudentNavbar";
import { searchProducts, searchTerms } from "../../lib/products/search";
import { STUDENT_DELIVERY_FEE, studentCatalogueCategoryWhere, studentCatalogueProductWhere } from "../../lib/products/catalogue";

type SearchPageProps = { searchParams: Promise<{ q?: string; category?: string }> };

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 100);
  const category = params.category ?? "";
  const browseOnly = !searchTerms(query).length && !category;
  const [categories, products] = await Promise.all([
    db.category.findMany({ where: studentCatalogueCategoryWhere, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    browseOnly
      ? db.product.findMany({
          where: studentCatalogueProductWhere,
          select: { id: true, name: true, customerPrice: true, imageUrl: true, category: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 24,
        })
      : searchProducts({ query, category }),
  ]);

  return (
    <main className="min-h-screen">
      <StudentNavbar />
      <div className="packam-container py-6 sm:py-10">
        <p className="pk-eyebrow">Campus marketplace</p>
        <h1 className="pk-page-title mt-2">{category === "" && !query ? "Find what you need" : "Search PackAM"}</h1>
        <p className="pk-muted mt-2 max-w-xl text-sm leading-6 sm:text-base">Prices include everything except the flat ₦{STUDENT_DELIVERY_FEE.toLocaleString()} delivery fee, added once per order at checkout.</p>
        <LiveSearch key={`${query}:${category}`} query={query} category={category} categories={categories} initialProducts={products} />
      </div>
    </main>
  );
}
