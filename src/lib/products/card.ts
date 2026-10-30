/**
 * What a product card needs, read the same way everywhere (marketplace, search, saved items).
 */
import { isBuyable, priceRange } from "./variants";

/** Prisma select for a product card. Only labels the admin left active are shown to students. */
export const productCardSelect = {
  id: true,
  name: true,
  customerPrice: true,
  imageUrl: true,
  stockQuantity: true,
  category: { select: { name: true } },
  labels: { where: { label: { isActive: true } }, orderBy: { label: { sortOrder: "asc" as const } }, select: { label: { select: { name: true } } } },
  variants: { where: { status: "ACTIVE" as const }, select: { price: true, stockQuantity: true, status: true } },
} as const;

export type ProductCardRow = {
  id: string;
  name: string;
  customerPrice: number;
  imageUrl: string | null;
  stockQuantity: number | null;
  category: { name: string };
  labels: Array<{ label: { name: string } }>;
  variants: Array<{ price: number; stockQuantity: number | null; status: string }>;
};

export type ProductCardData = {
  id: string;
  name: string;
  customerPrice: number;
  imageUrl: string | null;
  category: { name: string };
  labels: string[];
  /** Comes in options (colour, size…): chosen on the product page, not added straight from the card. */
  hasOptions: boolean;
  /** Options have different prices, so the card says "From". */
  priceVaries: boolean;
  outOfStock: boolean;
};

export function toProductCard(row: ProductCardRow): ProductCardData {
  const variants = row.variants.map((variant) => ({ ...variant, active: variant.status === "ACTIVE" }));
  const range = variants.length ? priceRange(variants) : null;
  return {
    id: row.id,
    name: row.name,
    customerPrice: range?.min ?? row.customerPrice,
    imageUrl: row.imageUrl,
    category: row.category,
    labels: row.labels.map((entry) => entry.label.name).slice(0, 3),
    hasOptions: variants.length > 0,
    priceVaries: Boolean(range && range.max > range.min),
    outOfStock: variants.length ? !variants.some(isBuyable) : row.stockQuantity !== null && row.stockQuantity <= 0,
  };
}
