import { db } from "../../lib/db";
import { LiveSearch } from "../../components/student/LiveSearch";
import { StudentNavbar } from "../../components/student/StudentNavbar";
import { searchProducts } from "../../lib/products/search";
import { studentCatalogueCategoryWhere } from "../../lib/products/catalogue";

type SearchPageProps = { searchParams: Promise<{ q?: string; category?: string }> };

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 100);
  const category = params.category ?? "";
  // "All" (no category, no search) uses the same paged query as everything else.
  const [categories, firstPage] = await Promise.all([
    db.category.findMany({ where: studentCatalogueCategoryWhere, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    searchProducts({ query, category }),
  ]);

  return (
    <main className="min-h-screen">
      <StudentNavbar />
      <div className="packam-container pb-8 pt-3 sm:py-10">
        <p className="pk-eyebrow">Campus marketplace</p>
        <h1 className="pk-page-title mt-1 max-sm:text-[1.625rem] sm:mt-2">{category === "" && !query ? "Wetin you need today?" : "Search PackAM"}</h1>
        <LiveSearch key={`${query}:${category}`} query={query} category={category} categories={categories} initialPage={firstPage} />
      </div>
    </main>
  );
}
