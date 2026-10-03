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
  return <main className="min-h-screen bg-[#fffdf7] pb-20">
    <div className="packam-container pt-6 sm:pt-8">
      <Link href="/search" className="text-sm font-bold text-black/50 hover:text-black">← Back to products</Link>
      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-10">
        <div className="overflow-hidden rounded-[1.5rem] border border-black/5 bg-white">
          <div className="relative aspect-square w-full">
            {product.imageUrl ? <Image src={product.imageUrl} alt={product.name} fill priority className="object-cover" /> : <div className="flex h-full items-center justify-center bg-[#f7f5ee] text-7xl">📦</div>}
          </div>
        </div>
        <div className="lg:pt-4">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-black/40">{product.category.name}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">{product.name}</h1>
          <p className="mt-4 text-3xl font-black">₦{product.customerPrice.toLocaleString()}</p>
          {product.description && <p className="mt-4 max-w-xl text-sm leading-6 text-black/65">{product.description}</p>}
          <p className="mt-4 text-sm font-semibold text-black/50">{available ? "Available now" : "We’ll check for you"}</p>
          <div className="mt-6"><AddToCart productId={product.id} /></div>
        </div>
      </div>
    </div>
  </main>;
}
