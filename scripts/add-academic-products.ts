/**
 * Adds the first academic products to the catalogue.
 *
 *   npm run catalogue:add-academic            # dry run: shows the plan, writes nothing
 *   npm run catalogue:add-academic -- --apply # creates/aligns the products
 *
 * Safety:
 * - Never deletes anything and never changes a price, status, image or description of an existing
 *   product. A product that already exists (same slug, a known older slug, or the same name) is reused;
 *   only its name and category are aligned.
 * - New products are created INACTIVE with no price ("price not set"), no image and no description, so
 *   they can't be bought until an admin sets a real price, adds a photo and activates them in
 *   Admin → Products. The database refuses an ACTIVE product without a price.
 * - Creates the "Academic Materials" category only if it doesn't exist (same slug as prisma/seed.ts).
 * - Uses DIRECT_URL like the seed script. Check which database that points at before applying.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { ACADEMIC_CATEGORY, academicProductLookup, planAcademicProducts } from "../src/lib/products/academic-products";

async function main() {
  const apply = process.argv.includes("--apply");
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) throw new Error("DIRECT_URL is not set.");
  const host = new URL(connectionString).hostname;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    console.log(`Database host: ${host}`);
    console.log(apply ? "Mode: APPLY" : "Mode: dry run (nothing will be written)");

    const category = await prisma.category.findUnique({ where: { slug: ACADEMIC_CATEGORY.slug }, select: { id: true, name: true, isActive: true } });
    console.log(category ? `\nCategory: ${category.name} [${ACADEMIC_CATEGORY.slug}]${category.isActive ? "" : " (inactive — students won't see it until it's activated)"}` : `\nCategory "${ACADEMIC_CATEGORY.name}" doesn't exist and will be created.`);

    const lookup = academicProductLookup();
    const existing = await prisma.product.findMany({
      where: { OR: [{ slug: { in: lookup.slugs } }, ...lookup.names.map((name) => ({ name: { equals: name, mode: "insensitive" as const } }))] },
      select: { id: true, name: true, slug: true, categoryId: true, status: true, customerPrice: true, imageUrl: true },
    });
    const plan = planAcademicProducts(existing, category?.id ?? "(new category)");

    for (const step of plan) {
      if (step.action === "create") {
        console.log(`  + create  ${step.spec.name} [${step.spec.slug}] — inactive, price not set, no image`);
      } else {
        const changes = [step.update.name && `rename "${step.existing.name}" → "${step.update.name}"`, step.update.categoryId && "move to Academic Materials"].filter(Boolean).join(", ");
        const price = step.existing.customerPrice >= 1 ? `₦${step.existing.customerPrice.toLocaleString()}` : "price not set";
        console.log(`  = reuse   ${step.spec.name} [${step.existing.slug}] — ${step.existing.status.toLowerCase()}, ${price}, ${step.existing.imageUrl ? "has image" : "no image"}${changes ? ` · ${changes}` : " · no changes"}`);
        if (step.existing.status === "ACTIVE" && !step.existing.imageUrl) console.log("            ⚠ active without a photo: check its price is real (seed demo data used made-up prices).");
      }
    }

    if (!apply) {
      console.log("\nRe-run with --apply to write these changes.");
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const categoryId = category?.id ?? (await tx.category.create({ data: { name: ACADEMIC_CATEGORY.name, slug: ACADEMIC_CATEGORY.slug }, select: { id: true } })).id;
      // Re-read inside the transaction so a concurrent change can't cause a duplicate.
      const current = await tx.product.findMany({
        where: { OR: [{ slug: { in: lookup.slugs } }, ...lookup.names.map((name) => ({ name: { equals: name, mode: "insensitive" as const } }))] },
        select: { id: true, name: true, slug: true, categoryId: true, status: true, customerPrice: true, imageUrl: true },
      });
      let created = 0;
      let updated = 0;
      for (const step of planAcademicProducts(current, categoryId)) {
        if (step.action === "create") {
          await tx.product.create({ data: step.data });
          created += 1;
        } else if (step.update.name || step.update.categoryId) {
          await tx.product.update({ where: { id: step.existing.id }, data: step.update });
          updated += 1;
        }
      }
      return { created, updated };
    });
    console.log(`\nCreated ${result.created}, updated ${result.updated}. Set prices and photos in Admin → Products (filter: Academic Materials, Inactive).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Adding academic products failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
