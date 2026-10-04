import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "../../../../lib/db";
import { AddToCart } from "../../../../components/products/AddToCart";

type ProductPageProps = { params: Promise<{ id: string }> };

export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params;
  const product = await db.product.findFirst({
    where: { id, status: "ACTIVE", category: { isActive: true } },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      customerPrice: true,
      category: { select: { name: true } },
      sources: {
        where: { vendor: { status: "ACTIVE" } },
        select: { availability: true },
      },
    },
  });
  if (!product) notFound();

  const available = product.sources.some((source) => source.availability === "AVAILABLE");
  return (
    <main className="min-h-screen bg-[#fffdf7] pb-12 sm:pb-20">
      <div className="packam-container pt-5 sm:pt-8">
        <Link
          href="/search"
          className="inline-flex min-h-11 items-center rounded-full pr-3 text-sm font-bold text-black/60 transition hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          ← Back to products
        </Link>
        <div className="mt-4 grid gap-5 sm:mt-6 sm:gap-6 lg:grid-cols-2 lg:items-start lg:gap-10">
          <div className="overflow-hidden rounded-2xl border border-black/5 bg-white sm:rounded-[1.5rem]">
            <div className="relative aspect-square w-full">
              {product.imageUrl ? (
                <Image src={product.imageUrl} alt={product.name} fill priority className="object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center bg-[#f7f5ee] text-6xl sm:text-7xl" aria-hidden="true">
                  📦
                </div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-black/5 bg-white p-5 sm:border-0 sm:bg-transparent sm:p-0 lg:pt-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-black/55 sm:text-sm">{product.category.name}</p>
            <h1 className="mt-2 text-[clamp(1.75rem,7vw,3rem)] font-black leading-tight tracking-tight sm:text-5xl">{product.name}</h1>
            <p className="mt-3 text-2xl font-black sm:mt-4 sm:text-3xl">₦{product.customerPrice.toLocaleString()}</p>
            {product.description && <p className="mt-4 max-w-xl text-base leading-7 text-black/70">{product.description}</p>}
            <p className="mt-4 inline-flex min-h-10 items-center rounded-full bg-[#fff4c7] px-4 text-sm font-bold text-black/75">
              {available ? "Available now" : "We’ll check for you"}
            </p>
            <div className="mt-5 sm:mt-6"><AddToCart productId={product.id} /></div>
            {!available && (
              <p className="mt-4 text-sm leading-6 text-black/60">
                Need a specific option?{" "}
                <Link
                  href={`/product-requests?name=${encodeURIComponent(product.name)}`}
                  className="font-bold text-black underline decoration-[#feb80a] decoration-2 underline-offset-4 hover:decoration-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                >
                  Request this product
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
