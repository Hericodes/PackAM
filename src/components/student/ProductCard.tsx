import Link from "next/link";
import { AddToCart } from "../products/AddToCart";
import { ProductVisual } from "../products/ProductVisual";
import { SaveProductButton } from "../products/SaveProductButton";

type ProductCardProps = { id: string; name: string; price: number; image?: string | null; category?: string };

export function ProductCard({ id, name, price, image, category }: ProductCardProps) {
  return (
    <article className="pk-card pk-card-interactive flex flex-col overflow-hidden">
      <div className="relative">
        <Link href={`/products/${id}`} aria-label={`View ${name}`} className="block focus-visible:outline-offset-[-3px]">
          <ProductVisual name={name} imageUrl={image} category={category} sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" className="aspect-4/3" />
        </Link>
        <div className="absolute right-2 top-2">
          <SaveProductButton productId={id} productName={name} />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {category && <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-black/60">{category}</p>}
        <h3 className="mt-1 line-clamp-2 text-[0.9375rem] font-extrabold leading-5">
          <Link href={`/products/${id}`} className="hover:underline">{name}</Link>
        </h3>
        <p className="mt-2 text-lg font-black">₦{price.toLocaleString()}</p>
        <div className="mt-auto pt-3">
          <AddToCart productId={id} compact />
        </div>
      </div>
    </article>
  );
}
