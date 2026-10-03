import Link from "next/link";
import { ProductForm } from "../../../../../components/products/ProductForm";
import { db } from "../../../../../lib/db";

export default async function NewRunnerProductPage() {
  const categories = await db.category.findMany({
    where: {
      isActive: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  return (
    <main className="min-h-screen bg-[#fffdf7]">
      <div className="packam-container max-w-3xl py-10">
        <Link
          href="/runner/products"
          className="text-sm font-black text-black/50 transition hover:text-black"
        >
          ← Back to Products
        </Link>

        <div className="mt-8">
          <p className="text-sm font-black uppercase tracking-[0.15em] text-black/40">
            Runner
          </p>

          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Add Product
          </h1>

          <p className="mt-2 text-sm leading-6 text-black/50">
            Add a product that students can find on the PackAM marketplace.
          </p>
        </div>

        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 shadow-sm sm:p-8">
          <ProductForm categories={categories} />
        </div>
      </div>
    </main>
  );
}