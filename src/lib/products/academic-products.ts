/**
 * The first academic products for the PackAM catalogue, and how to add them without duplicates.
 * Pure: the script in scripts/add-academic-products.ts reads the database and applies this plan.
 *
 * Nothing here is invented. New products get no price, image, description, vendor or variant: they
 * are created INACTIVE with the "price not set" value, so they can't be bought until an admin sets a
 * real price and activates them in Admin → Products.
 */
import { PRICE_NOT_SET } from "../catalogue-permissions";

export const ACADEMIC_CATEGORY = { name: "Academic Materials", slug: "academic-materials" } as const;

export type AcademicProductSpec = {
  name: string;
  slug: string;
  /** Older slugs that refer to the same item (e.g. seed data), reused instead of duplicated. */
  aliasSlugs?: string[];
};

export const ACADEMIC_PRODUCTS: readonly AcademicProductSpec[] = [
  { name: "Blue Ballpoint Pen", slug: "blue-ballpoint-pen" },
  { name: "8-in-1 Lecture Notebook", slug: "8-in-1-lecture-notebook" },
  { name: "Single-Subject Exercise Book", slug: "single-subject-exercise-book", aliasSlugs: ["exercise-book"] },
  { name: "Project File", slug: "project-file" },
  { name: "A4 Paper", slug: "a4-paper" },
  { name: "Transparent Document File", slug: "transparent-document-file" },
  { name: "HB Pencil", slug: "hb-pencil" },
  { name: "Highlighter", slug: "highlighter" },
];

export type ExistingProduct = { id: string; name: string; slug: string; categoryId: string; status: string; customerPrice: number; imageUrl: string | null };

export type AcademicProductPlan =
  | { action: "create"; spec: AcademicProductSpec; data: { name: string; slug: string; categoryId: string; customerPrice: number; status: "INACTIVE"; imageUrl: null; description: null } }
  | { action: "reuse"; spec: AcademicProductSpec; existing: ExistingProduct; update: { name?: string; categoryId?: string } };

const normaliseName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * For each product: reuse a record with the same slug, an alias slug or the same name; otherwise
 * create one. A reused record keeps its price, status, image and description exactly as they are;
 * only its name and category are aligned. Running the plan twice changes nothing the second time.
 */
export function planAcademicProducts(existing: ExistingProduct[], categoryId: string): AcademicProductPlan[] {
  const claimed = new Set<string>();
  return ACADEMIC_PRODUCTS.map((spec) => {
    const slugs = [spec.slug, ...(spec.aliasSlugs ?? [])];
    const match = slugs.map((slug) => existing.find((product) => product.slug === slug && !claimed.has(product.id))).find(Boolean)
      ?? existing.find((product) => normaliseName(product.name) === normaliseName(spec.name) && !claimed.has(product.id));
    if (match) {
      claimed.add(match.id);
      const update: { name?: string; categoryId?: string } = {};
      if (match.name !== spec.name) update.name = spec.name;
      if (match.categoryId !== categoryId) update.categoryId = categoryId;
      return { action: "reuse" as const, spec, existing: match, update };
    }
    return {
      action: "create" as const,
      spec,
      data: { name: spec.name, slug: spec.slug, categoryId, customerPrice: PRICE_NOT_SET, status: "INACTIVE" as const, imageUrl: null, description: null },
    };
  });
}

/** Every slug and name the plan could match, for one database lookup. */
export function academicProductLookup() {
  return {
    slugs: ACADEMIC_PRODUCTS.flatMap((spec) => [spec.slug, ...(spec.aliasSlugs ?? [])]),
    names: ACADEMIC_PRODUCTS.map((spec) => spec.name),
  };
}
