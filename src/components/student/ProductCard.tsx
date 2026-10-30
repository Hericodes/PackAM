import Link from "next/link";
import { AddToCart } from "../products/AddToCart";
import { ProductVisual } from "../products/ProductVisual";
import { SaveProductButton } from "../products/SaveProductButton";
import { Icon } from "../ui/Icon";

type ProductCardProps = {
  id: string; name: string; price: number; image?: string | null; category?: string;
  /** Badges the admin assigned, e.g. Popular. */
  labels?: string[];
  /** Comes in options: chosen on the product page instead of added from the card. */
  hasOptions?: boolean;
  /** Options cost different amounts, so the price reads "From". */
  priceVaries?: boolean;
  outOfStock?: boolean;
};

/**
 * Shared shopping card. Only the image and the name are links; the save and add-to-cart buttons sit
 * outside them so tapping either never opens the product page.
 */
export function ProductCard({ id, name, price, image, category, labels = [], hasOptions = false, priceVaries = false, outOfStock = false }: ProductCardProps) {
  const href = `/products/${id}`;
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-[18px] border sm:rounded-[22px] border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(8,8,8,0.04)] transition duration-200 hover:border-black/[0.12] hover:shadow-[0_14px_30px_-18px_rgba(135,90,0,0.45)] focus-within:border-black/20 motion-safe:hover:-translate-y-0.5">
      <div className="relative">
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block">
          <ProductVisual
            name={name}
            imageUrl={image}
            category={category}
            sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
            className="aspect-[3/2] transition-transform sm:aspect-4/3 duration-300 motion-safe:group-hover:scale-[1.02]"
          />
        </Link>
        {labels.length > 0 && (
          <ul className="pointer-events-none absolute left-2 top-2 flex max-w-[60%] flex-col items-start gap-1 sm:left-2.5 sm:top-2.5" aria-label="Labels">
            {labels.slice(0, 2).map((label) => <li key={label} className="truncate rounded-full bg-[#feb80a] px-2 py-0.5 text-[0.625rem] font-black uppercase tracking-wide text-black shadow-sm sm:text-[0.6875rem]">{label}</li>)}
          </ul>
        )}
        <div className="absolute right-2 top-2 sm:right-2.5 sm:top-2.5">
          <SaveProductButton productId={id} productName={name} />
        </div>
      </div>

      <div className="flex flex-1 flex-col border-t border-black/[0.05] p-2.5 sm:p-4">
        {category && (
          <p className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.03em] text-black/55 sm:text-[0.6875rem] sm:tracking-[0.08em]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#feb80a]" aria-hidden="true" />
            <span className="truncate">{category}</span>
          </p>
        )}
        <h3 className="mt-1 text-sm font-extrabold leading-[1.125rem] text-black sm:mt-1.5 sm:text-base sm:leading-5">
          <Link
            href={href}
            title={name}
            className="line-clamp-2 rounded-sm decoration-2 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {name}
          </Link>
        </h3>
        {/* Price and action share the card's bottom edge, so they align across a row whatever the name length.
            Phones: side by side. From sm up: price above a full-width button. */}
        <div className="mt-auto flex items-center justify-between gap-1.5 pt-2 sm:block sm:pt-2.5">
          <p className="flex min-w-0 items-baseline gap-0.5 whitespace-nowrap font-black tracking-tight text-black">
            {priceVaries && <span className="mr-0.5 text-[0.6875rem] font-bold text-black/55 sm:text-xs">From</span>}
            <span className="text-[0.8125rem] sm:text-sm">₦</span>
            <span className="text-lg leading-none sm:text-[1.375rem]">{price.toLocaleString()}</span>
          </p>
          <div className="shrink-0 sm:pt-3">
            {outOfStock ? (
              <span className="flex h-10 items-center justify-center rounded-full bg-black/6 px-3 text-xs font-black text-black/55 sm:min-h-11 sm:w-full">Sold out</span>
            ) : hasOptions ? (
              <Link href={href} aria-label={`Choose options for ${name}`} className="flex h-10 w-10 items-center justify-center gap-2 rounded-full bg-black text-[0.8125rem] font-black text-white transition hover:bg-[#262626] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:h-auto sm:min-h-11 sm:w-full sm:px-3">
                <span className="sr-only sm:not-sr-only">Choose options</span>
                <Icon name="chevronRight" className="h-5 w-5 sm:h-4 sm:w-4" strokeWidth={2.6} />
              </Link>
            ) : (
              <AddToCart productId={id} compact />
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/** Placeholder with the card's real proportions, so the grid does not jump when products arrive. */
export function ProductCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[18px] border border-black/[0.07] bg-white sm:rounded-[22px]" aria-hidden="true">
      <div className="pk-skeleton aspect-[3/2] rounded-none sm:aspect-4/3" />
      <div className="flex flex-1 flex-col gap-2 border-t border-black/[0.05] p-2.5 sm:p-4">
        <div className="pk-skeleton h-3 w-2/5" />
        <div className="pk-skeleton h-4 w-4/5" />
        <div className="mt-auto flex items-center justify-between pt-2 sm:block sm:pt-2.5"><div className="pk-skeleton h-5 w-1/3" /><div className="pk-skeleton h-10 w-10 rounded-full sm:mt-3 sm:h-11 sm:w-full" /></div>
      </div>
    </div>
  );
}
