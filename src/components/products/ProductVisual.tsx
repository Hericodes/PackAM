import Image from "next/image";
import { categoryDisplay, productGlyph } from "../../lib/products/category-display";

type ProductVisualProps = {
  name: string;
  imageUrl?: string | null;
  category?: string | null;
  sizes: string;
  priority?: boolean;
  className?: string;
  /** "contain" frames the whole photo on the gradient (cards); "cover" fills the area (detail page). */
  fit?: "cover" | "contain";
};

/** Product photo on a soft warm gradient, or a small name-based illustration when no photo exists yet. */
export function ProductVisual({ name, imageUrl, category, sizes, priority, className = "", fit = "cover" }: ProductVisualProps) {
  const display = categoryDisplay(category);
  return (
    <div className={`pk-media pk-media-${display.tone} relative overflow-hidden ${className}`}>
      {imageUrl ? (
        fit === "contain" ? (
          <div className="absolute inset-2.5 sm:inset-3">
            <Image src={imageUrl} alt={name} fill sizes={sizes} priority={priority} className="rounded-xl object-contain drop-shadow-[0_6px_14px_rgba(8,8,8,0.12)]" />
          </div>
        ) : (
          <Image src={imageUrl} alt={name} fill sizes={sizes} priority={priority} className="object-cover" />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="flex aspect-square w-[38%] max-w-28 items-center justify-center rounded-[28%] bg-white/70 shadow-[0_8px_24px_-12px_rgba(135,90,0,0.45)] ring-1 ring-white" aria-hidden="true">
            <span className="text-[clamp(1.75rem,6vw,2.75rem)] leading-none">{productGlyph(name, category)}</span>
          </span>
          <span className="sr-only">{name}</span>
        </div>
      )}
    </div>
  );
}
