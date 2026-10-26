/**
 * Notebooks, ID cards, stationery and clothing supplied by PackAM operations (October 2026 price list),
 * and how to add them without duplicates. Pure: scripts/add-student-supplies.ts reads the database and
 * applies this plan.
 *
 * Only the supplied names and naira prices are used. No stock counts, vendors, sizes, images or variants
 * are invented: PackAM keeps no stock counts (runners record the shop and its availability when they
 * buy an item), and products without a photo show the storefront's category illustration.
 */

export type CatalogueCategory = { name: string; slug: string };

export const SUPPLY_CATEGORIES = {
  academic: { name: "Academic Materials", slug: "academic-materials" },
  clothing: { name: "Clothing", slug: "clothing" },
} as const satisfies Record<string, CatalogueCategory>;

export type SupplySpec = {
  name: string;
  slug: string;
  category: keyof typeof SUPPLY_CATEGORIES;
  /** Whole naira, exactly as supplied. */
  price: number;
  /** Supplied wording that describes the item rather than naming it. */
  description?: string;
  /** Older slugs for the same item (seed data or earlier scripts), reused instead of duplicated. */
  aliasSlugs?: string[];
  /** Created hidden until operations answers this; the product is saved but students can't see it. */
  holdReason?: string;
};

export const STUDENT_SUPPLIES: readonly SupplySpec[] = [
  // A. Notebooks and exercise books
  { name: "5-in-1 Notebook", slug: "5-in-1-notebook", category: "academic", price: 1_500 },
  // ₦8,000 is as supplied, though it is far above the 10-in-1 (₦2,500); flagged for confirmation, not changed.
  { name: "8-in-1 Notebook", slug: "8-in-1-notebook", category: "academic", price: 8_000, aliasSlugs: ["8-in-1-lecture-notebook"] },
  { name: "10-in-1 Notebook", slug: "10-in-1-notebook", category: "academic", price: 2_500 },
  { name: "12-in-1 Notebook", slug: "12-in-1-notebook", category: "academic", price: 3_000 },
  { name: "Higher Education Notebook", slug: "higher-education-notebook", category: "academic", price: 1_000, description: "For text and assignments." },
  { name: "60-Leaf Exercise Book", slug: "60-leaf-exercise-book", category: "academic", price: 400 },
  { name: "60-Leaf Exercise Books (Dozen)", slug: "60-leaf-exercise-books-dozen", category: "academic", price: 4_000 },
  { name: "40-Leaf Exercise Book", slug: "40-leaf-exercise-book", category: "academic", price: 300 },
  { name: "40-Leaf Exercise Books (Dozen)", slug: "40-leaf-exercise-books-dozen", category: "academic", price: 3_000 },
  // B. ID cards and holders: separate products, so each order line is unambiguous.
  { name: "Fashion ID Card Holder", slug: "fashion-id-card-holder", category: "academic", price: 2_000 },
  { name: "ID Card with Strong Holder", slug: "id-card-with-strong-holder", category: "academic", price: 1_000 },
  { name: "ID Card with Weak Holder", slug: "id-card-with-weak-holder", category: "academic", price: 700 },
  { name: "ID Card Logo and Case", slug: "id-card-logo-and-case", category: "academic", price: 700 },
  // C. Stationery and general academic supplies
  { name: "Blue Ballpoint Pen", slug: "blue-ballpoint-pen", category: "academic", price: 100 },
  { name: "Black Ballpoint Pen", slug: "black-ballpoint-pen", category: "academic", price: 100 },
  { name: "Whiteboard Marker", slug: "whiteboard-marker", category: "academic", price: 400 },
  { name: "Top Gum (Standard Size)", slug: "top-gum-standard-size", category: "academic", price: 500 },
  { name: "Top Gum (Big Size)", slug: "top-gum-big-size", category: "academic", price: 1_000 },
  { name: "Nylon File (Thick)", slug: "nylon-file-thick", category: "academic", price: 500 },
  { name: "Nylon File (Normal)", slug: "nylon-file-normal", category: "academic", price: 400 },
  { name: "Ruler (Long)", slug: "ruler-long", category: "academic", price: 200 },
  { name: "Ruler (Short)", slug: "ruler-short", category: "academic", price: 100 },
  { name: "Eraser", slug: "eraser", category: "academic", price: 100 },
  { name: "Project File", slug: "project-file", category: "academic", price: 400 },
  // D. Clothing and student essentials
  { name: "Lab Coat", slug: "lab-coat", category: "clothing", price: 5_000 },
  { name: "Student Belt", slug: "student-belt", category: "clothing", price: 3_000 },
  { name: "Departmental Wear", slug: "departmental-wear", category: "clothing", price: 7_000 },
  { name: "Pant Trouser (Option 1)", slug: "pant-trouser-option-1", category: "clothing", price: 8_000, holdReason: "what makes option 1 different from option 2 (fabric, size, style) isn't known yet" },
  { name: "Pant Trouser (Option 2)", slug: "pant-trouser-option-2", category: "clothing", price: 10_000, holdReason: "what makes option 2 different from option 1 (fabric, size, style) isn't known yet" },
];

export type ExistingCatalogueProduct = { id: string; name: string; slug: string; categoryId: string; status: string; customerPrice: number; imageUrl: string | null };

export type SupplyPlan =
  | { action: "create"; spec: SupplySpec; data: { name: string; slug: string; categoryId: string; customerPrice: number; status: "ACTIVE" | "INACTIVE"; imageUrl: null; description: string | null } }
  | { action: "reuse"; spec: SupplySpec; existing: ExistingCatalogueProduct }
  | { action: "conflict"; spec: SupplySpec; existing: ExistingCatalogueProduct; reason: string };

const normaliseName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * For each supply: an existing product with the same slug, an alias slug or the same name is reused and
 * left exactly as it is. If its price differs from the supplied one it is reported as a conflict and still
 * not changed: an existing price can only change through Admin → Products, by someone who has confirmed it.
 * Anything else is created with the supplied price, ACTIVE unless it has a hold reason. Running the plan
 * again after applying it creates nothing.
 */
export function planStudentSupplies(existing: ExistingCatalogueProduct[], categoryIds: Record<keyof typeof SUPPLY_CATEGORIES, string>): SupplyPlan[] {
  const claimed = new Set<string>();
  const usedSlugs = new Set(existing.map((product) => product.slug));
  return STUDENT_SUPPLIES.map((spec) => {
    const match = [spec.slug, ...(spec.aliasSlugs ?? [])].map((slug) => existing.find((product) => product.slug === slug && !claimed.has(product.id))).find(Boolean)
      ?? existing.find((product) => normaliseName(product.name) === normaliseName(spec.name) && !claimed.has(product.id));
    if (match) {
      claimed.add(match.id);
      if (match.customerPrice !== spec.price) {
        const current = match.customerPrice >= 1 ? `₦${match.customerPrice.toLocaleString("en-NG")}` : "no price";
        return { action: "conflict" as const, spec, existing: match, reason: `already in the catalogue at ${current}; the new list says ₦${spec.price.toLocaleString("en-NG")}` };
      }
      return { action: "reuse" as const, spec, existing: match };
    }
    if (usedSlugs.has(spec.slug)) throw new Error(`Slug ${spec.slug} is taken by a product that doesn't match ${spec.name}.`);
    usedSlugs.add(spec.slug);
    return {
      action: "create" as const,
      spec,
      data: { name: spec.name, slug: spec.slug, categoryId: categoryIds[spec.category], customerPrice: spec.price, status: spec.holdReason ? "INACTIVE" as const : "ACTIVE" as const, imageUrl: null, description: spec.description ?? null },
    };
  });
}

/** Every slug and name the plan could match, for one database lookup. */
export function studentSupplyLookup() {
  return {
    slugs: STUDENT_SUPPLIES.flatMap((spec) => [spec.slug, ...(spec.aliasSlugs ?? [])]),
    names: STUDENT_SUPPLIES.map((spec) => spec.name),
  };
}

/**
 * The database the script may write to must be named on the command line, so it can never write to
 * whatever DIRECT_URL happens to point at by accident.
 */
export function confirmedWriteTarget(host: string, argv: string[]) {
  const flag = argv.find((arg) => arg.startsWith("--database-host="));
  return Boolean(flag && flag.slice("--database-host=".length) === host);
}
