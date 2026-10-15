import Image from "next/image";
import { categoryDisplay } from "../../lib/products/category-display";

type ProductVisualProps = {
  name: string;
  imageUrl?: string | null;
  category?: string | null;
  sizes: string;
  priority?: boolean;
  className?: string;
};

/** Product photo, or a calm category tile when no photo has been uploaded yet. */
export function ProductVisual({ name, imageUrl, category, sizes, priority, className = "" }: ProductVisualProps) {
  const display = categoryDisplay(category);
  return (
    <div className={`relative overflow-hidden ${className}`} style={imageUrl ? undefined : { backgroundColor: display.tint }}>
      {imageUrl ? (
        <Image src={imageUrl} alt={name} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-[clamp(2rem,9vw,3.5rem)] leading-none" aria-hidden="true">{display.icon}</span>
          <span className="sr-only">{name}</span>
        </div>
      )}
    </div>
  );
}
