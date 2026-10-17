import { categoryDisplay, productGlyph } from "../../lib/products/category-display";
import { ProductPhoto } from "./ProductPhoto";

type ProductVisualProps = {
  name: string;
  imageUrl?: string | null;
  category?: string | null;
  sizes: string;
  priority?: boolean;
  className?: string;
};

/**
 * The product's image area. A real photo always fills the frame (see ProductPhoto); without a photo,
 * or if it fails to load, a modest name-based illustration sits on a soft PackAM gradient.
 */
export function ProductVisual({ name, imageUrl, category, sizes, priority, className = "" }: ProductVisualProps) {
  const display = categoryDisplay(category);
  const illustration = (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <span className="flex aspect-square w-[36%] max-w-32 items-center justify-center rounded-[30%] bg-white/75 shadow-[0_10px_26px_-14px_rgba(135,90,0,0.5)] ring-1 ring-white" aria-hidden="true">
        <span className="text-[clamp(1.75rem,6vw,3rem)] leading-none">{productGlyph(name, category)}</span>
      </span>
      {/* Soft ground shadow so the tile sits in the scene rather than floating. */}
      <span className="mt-2 h-2 w-[26%] max-w-24 rounded-[50%] bg-[#875a00]/10 blur-[3px]" aria-hidden="true" />
      <span className="sr-only">{name}</span>
    </div>
  );
  return (
    <div className={`pk-media pk-media-${display.tone} relative isolate overflow-hidden ${className}`}>
      {imageUrl ? <ProductPhoto src={imageUrl} alt={name} sizes={sizes} priority={priority} fallback={illustration} /> : illustration}
    </div>
  );
}
