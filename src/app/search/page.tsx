import { db } from "../../lib/db";
import { LiveSearch } from "../../components/student/LiveSearch";
import { StudentNavbar } from "../../components/student/StudentNavbar";

type SearchPageProps = { searchParams: Promise<{ q?: string; category?: string }> };

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 100);
  const category = params.category ?? "";
  const terms = [...new Set(query.toLocaleLowerCase().split(/\s+/).filter((term) => term.length >= 2))].slice(0, 8);
  const [categories, products] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    db.product.findMany({
      where: {
        status: "ACTIVE",
        category: { isActive: true, ...(category ? { slug: category } : {}) },
        ...(terms.length ? { OR: terms.flatMap((term) => [
          { name: { contains: term, mode: "insensitive" as const } },
          { description: { contains: term, mode: "insensitive" as const } },
          { category: { name: { contains: term, mode: "insensitive" as const } } },
        ]) } : {}),
      },
      select: { id: true, name: true, customerPrice: true, imageUrl: true, category: { select: { name: true } } },
      take: 24,
    }),
  ]);

  return <main className="min-h-screen bg-[#fffdf7]"><StudentNavbar/><div className="packam-container py-6 sm:py-10"><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Find what you need</h1><LiveSearch key={`${query}:${category}`} query={query} category={category} categories={categories} initialProducts={products}/></div></main>;
}
