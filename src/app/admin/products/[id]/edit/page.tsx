import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "../../../../../components/products/ProductForm";
import { db } from "../../../../../lib/db";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditAdminProductPage({
  params,
}: PageProps) {
  const { id } = await params;

  const [product, categories] = await Promise.all([
    db.product.findUnique({
      where: {
        id,
      },
    }),

    db.category.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
  ]);

  if (!product) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#fffdf7]">
      <div className="packam-container max-w-3xl py-10">
        <Link
          href="/admin/products"
          className="text-sm font-black text-black/50 transition hover:text-black"
        >
          ← Back to Products
        </Link>

        <div className="mt-8">
          <p className="text-sm font-black uppercase tracking-[0.15em] text-black/40">
            Admin
          </p>

          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Edit Product
          </h1>

          <p className="mt-2 text-sm leading-6 text-black/50">
            Update the product information shown on the marketplace.
          </p>
        </div>

        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 shadow-sm sm:p-8">
          <ProductForm
            categories={categories}
            initialData={{
              id: product.id,
              name: product.name,
              description: product.description,
              imageUrl: product.imageUrl,
              categoryId: product.categoryId,
              customerPrice: product.customerPrice,
              status: product.status,
            }}
          />
        </div>
      </div>
    </main>
  );
}