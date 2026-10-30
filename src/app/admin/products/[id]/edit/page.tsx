import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../../lib/auth-guard";
import { db } from "../../../../../lib/db";
import { ProductForm } from "../../../../../components/products/ProductForm";
import { VariantEditor } from "../../../../../components/admin/VariantEditor";
import { loadProductFormOptions } from "../../../../../lib/products/product-form-data";
import { loadVariantSetup } from "../../../../../lib/products/variant-store";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditAdminProductPage({ params }: PageProps) {
  await requireRole("ADMIN");
  const { id } = await params;
  const [product, options, setup] = await Promise.all([
    db.product.findUnique({ where: { id }, select: { id: true, name: true, description: true, imageUrl: true, categoryId: true, customerPrice: true, status: true, subcategoryId: true, stockQuantity: true, shopId: true, labels: { select: { labelId: true } } } }),
    loadProductFormOptions(),
    loadVariantSetup(id),
  ]);
  if (!product || !setup) notFound();
  if (product.shopId) return <main className="min-h-screen"><div className="packam-container max-w-3xl py-10"><p className="text-sm">This is a food menu item. Edit it in <Link href={`/admin/food/${product.shopId}`} className="font-bold underline">Admin → Food</Link>.</p></div></main>;
  const hasVariants = setup.variants.length > 0;

  return (
    <main className="min-h-screen">
      <div className="packam-container max-w-3xl py-10">
        <Link href="/admin/products" className="text-sm font-black text-black/50 transition hover:text-black">← Back to Products</Link>
        <div className="mt-8">
          <p className="text-sm font-black uppercase tracking-[0.15em] text-black/40">Admin</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Edit Product</h1>
          <p className="mt-2 text-sm leading-6 text-black/50">Update the product information shown on the marketplace.</p>
        </div>
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 shadow-sm sm:p-8">
          <ProductForm
            categories={options.categories}
            labels={options.labels}
            initialData={{
              id: product.id,
              name: product.name,
              description: product.description,
              imageUrl: product.imageUrl,
              categoryId: product.categoryId,
              customerPrice: product.customerPrice,
              status: product.status,
              subcategoryId: product.subcategoryId,
              labelIds: product.labels.map((label) => label.labelId),
              stockQuantity: product.stockQuantity,
              hasVariants,
            }}
          />
        </div>
        <div className="mt-6">
          <VariantEditor productId={product.id} initialOptions={setup.options} initialVariants={setup.variants} />
        </div>
      </div>
    </main>
  );
}
