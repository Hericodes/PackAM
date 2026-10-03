import Image from "next/image";
import Link from "next/link";
import { AddToCart } from "../products/AddToCart";

type ProductCardProps = { id: string; name: string; price: number; image?: string | null; category?: string };

export function ProductCard({ id, name, price, image, category }: ProductCardProps) {
  return <article className="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm">
    <Link href={`/products/${id}`} aria-label={`View ${name}`} className="block">
      <div className="relative aspect-square overflow-hidden bg-[#f3f3f3]">
        {image ? <Image src={image} alt={name} fill className="object-cover" /> : <div className="flex h-full items-center justify-center"><span className="text-5xl" aria-hidden="true">📦</span></div>}
      </div>
      <div className="p-4 pb-2">
        {category && <p className="text-xs font-bold uppercase tracking-wide text-black/40">{category}</p>}
        <h3 className="mt-1 line-clamp-2 text-sm font-black leading-5">{name}</h3>
        <p className="mt-3 text-base font-black">₦{price.toLocaleString()}</p>
      </div>
    </Link>
    <div className="px-4 pb-4"><AddToCart productId={id} /></div>
  </article>;
}
