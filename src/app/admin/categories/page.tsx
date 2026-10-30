import { db } from "../../../lib/db";
import { requireRole } from "../../../lib/auth-guard";
import { AdminCategories } from "../../../components/admin/AdminCategories";

export default async function AdminCategoriesPage() {
  await requireRole("ADMIN");
  const categories = await db.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 200,
    select: {
      id: true, name: true, slug: true, description: true, imageUrl: true, isActive: true, sortOrder: true,
      _count: { select: { products: true } },
      subcategories: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, description: true, isActive: true, sortOrder: true, _count: { select: { products: true } } } },
    },
  });
  return <main className="min-h-screen"><div className="packam-container py-8"><h1 className="text-3xl font-black">Categories</h1><AdminCategories categories={categories} /></div></main>;
}
