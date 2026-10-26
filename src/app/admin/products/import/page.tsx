import Link from "next/link";
import { requireRole } from "../../../../lib/auth-guard";
import { db } from "../../../../lib/db";
import { ProductImport } from "../../../../components/admin/ProductImport";

export default async function AdminProductImportPage() {
  await requireRole("ADMIN");
  const categories = await db.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } });

  return (
    <main className="min-h-screen">
      <div className="packam-container max-w-5xl py-8 sm:py-10">
        <Link href="/admin/products" className="inline-flex min-h-11 items-center text-sm font-black text-black/50 transition hover:text-black">← Back to Products</Link>
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-black/40">Catalogue</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Bulk import products</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-black/55">Upload a CSV, check the preview, then import. Nothing is saved until you confirm. Photos are added afterwards, one product at a time.</p>
        </div>
        <div className="mt-6">
          <ProductImport categoryNames={categories.map((category) => category.name)} />
        </div>
      </div>
    </main>
  );
}
