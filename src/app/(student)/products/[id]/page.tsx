import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "../../../../lib/db";
import { AddToCart } from "../../../../components/products/AddToCart";
import { ProductVisual } from "../../../../components/products/ProductVisual";
import { SaveProductButton } from "../../../../components/products/SaveProductButton";
import { STUDENT_DELIVERY_FEE, studentCatalogueProductWhere } from "../../../../lib/products/catalogue";

type ProductPageProps = { params: Promise<{ id: string }> };

export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params;
  const product = await db.product.findFirst({
    where: { id, ...studentCatalogueProductWhere },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      customerPrice: true,
      category: { select: { name: true, slug: true } },
      sources: { where: { vendor: { status: "ACTIVE" } }, select: { availability: true } },
    },
  });
  if (!product) notFound();

  const confirmedInStock = product.sources.some((source) => source.availability === "AVAILABLE");
  return (
    <main className="min-h-screen pb-16">
      <div className="packam-container pt-5 sm:pt-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-black/65">
            <li><Link href="/search" className="font-semibold hover:text-black hover:underline">Shop</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href={`/search?category=${product.category.slug}`} className="font-semibold hover:text-black hover:underline">{product.category.name}</Link></li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="truncate font-semibold text-black">{product.name}</li>
          </ol>
        </nav>

        <div className="mt-5 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          <div className="pk-card overflow-hidden">
            <ProductVisual name={product.name} imageUrl={product.imageUrl} category={product.category.slug} sizes="(min-width: 1024px) 50vw, 100vw" priority className="aspect-4/3 lg:aspect-square" />
          </div>

          <div className="lg:pt-2">
            <p className="pk-eyebrow">{product.category.name}</p>
            <h1 className="pk-page-title mt-2">{product.name}</h1>
            <p className="mt-3 text-3xl font-black">₦{product.customerPrice.toLocaleString()}</p>
            <p className="mt-3">
              {confirmedInStock
                ? <span className="pk-pill pk-pill-success">● Confirmed in stock nearby</span>
                : <span className="pk-pill pk-pill-neutral">Not yet confirmed in stock — your runner checks campus shops</span>}
            </p>
            {product.description && <p className="pk-muted mt-5 max-w-xl text-base leading-7">{product.description}</p>}

            <div className="pk-card mt-6 p-4 sm:p-5">
              <AddToCart productId={product.id} />
              <div className="mt-3">
                <SaveProductButton productId={product.id} productName={product.name} variant="full" />
              </div>
            </div>

            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div className="pk-card p-4">
                <dt className="font-extrabold">Delivery</dt>
                <dd className="pk-muted mt-1 leading-6">₦{STUDENT_DELIVERY_FEE.toLocaleString()} flat per order, added once at checkout.</dd>
              </div>
              <div className="pk-card p-4">
                <dt className="font-extrabold">If the shop price changes</dt>
                <dd className="pk-muted mt-1 leading-6">We ask you before anything changes. You can continue or cancel for a refund.</dd>
              </div>
            </dl>

            <p className="pk-muted mt-5 text-sm leading-6">
              Need a different size, brand or flavour?{" "}
              <Link href={`/product-requests?name=${encodeURIComponent(product.name)}`} className="font-bold text-black underline decoration-[#feb80a] decoration-2 underline-offset-4 hover:decoration-black">
                Request it
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
