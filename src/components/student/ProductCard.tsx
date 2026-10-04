import Image from "next/image";
import Link from "next/link";
import { AddToCart } from "../products/AddToCart";

type ProductCardProps = { id: string; name: string; price: number; image?: string | null; category?: string };

export function ProductCard({ id, name, price, image, category }: ProductCardProps) {
  return <article className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition-shadow hover:shadow-md sm:rounded-3xl">
    <Link href={`/products/${id}`} aria-label={`View ${name}`} className="block rounded-t-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black sm:rounded-t-3xl">
      <div className="relative aspect-square overflow-hidden bg-[#f3f3f3]">
        {image ? <Image src={image} alt={name} fill className="object-cover" /> : <div className="flex h-full items-center justify-center"><span className="text-5xl" aria-hidden="true">📦</span></div>}
      </div>
      <div className="p-3 pb-2 sm:p-4 sm:pb-2">
        {category && <p className="text-xs font-bold uppercase tracking-wide text-black/60">{category}</p>}
        <h3 className="mt-1 line-clamp-2 text-base font-black leading-5">{name}</h3>
        <p className="mt-2 text-base font-black sm:mt-3 sm:text-lg">₦{price.toLocaleString()}</p>
      </div>
    </Link>
    <div className="px-3 pb-3 sm:px-4 sm:pb-4"><AddToCart productId={id} /></div>
  </article>;
}
