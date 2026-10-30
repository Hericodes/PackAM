import { db } from "../../lib/db";
import { LiveSearch } from "../../components/student/LiveSearch";
import { StudentNavbar } from "../../components/student/StudentNavbar";
import { searchProducts } from "../../lib/products/search";
import { studentCatalogueCategoryWhere, studentCatalogueProductWhere } from "../../lib/products/catalogue";

type SearchPageProps = { searchParams: Promise<{ q?: string; category?: string; sub?: string; label?: string }> };

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 100);
  const category = params.category ?? "";
  const sub = category ? (params.sub ?? "") : "";
  const label = params.label ?? "";
  // "All" (no category, no search) uses the same paged query as everything else.
  const [categories, labels, firstPage] = await Promise.all([
    db.category.findMany({
      where: studentCatalogueCategoryWhere,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { name: true, slug: true, subcategories: { where: { isActive: true, products: { some: studentCatalogueProductWhere } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true, slug: true } } },
    }),
    // Only labels that are on something students can buy, so a filter never leads to an empty page.
    db.productLabel.findMany({ where: { isActive: true, products: { some: { product: studentCatalogueProductWhere } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true, slug: true } }),
    searchProducts({ query, category, subcategory: sub, label }),
  ]);

  return (
    <main className="min-h-screen">
      <StudentNavbar />
      <div className="packam-container pb-8 pt-3 sm:py-10">
        <p className="pk-eyebrow">Campus marketplace</p>
        <h1 className="pk-page-title mt-1 max-sm:text-[1.625rem] sm:mt-2">{category === "" && !query ? "Wetin you need today?" : "Search PackAM"}</h1>
        <LiveSearch key={`${query}:${category}:${sub}:${label}`} query={query} category={category} sub={sub} label={label} categories={categories} labels={labels} initialPage={firstPage} />
      </div>
    </main>
  );
}
