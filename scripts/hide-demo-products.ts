/**
 * Hides the demo products created by prisma/seed.ts from the student catalogue.
 *
 *   npm run catalogue:hide-demo            # dry run: lists what would change, writes nothing
 *   npm run catalogue:hide-demo -- --apply # sets matching products to INACTIVE
 *
 * Safety:
 * - Never deletes anything. Hidden products keep their history; orders keep their own item names
 *   and prices, and an admin can re-activate a product at any time.
 * - Only touches products whose slug exactly matches a seed slug, that are still ACTIVE and still
 *   have no image (a product an admin has given a photo is treated as real and left alone).
 * - Uses DIRECT_URL like the seed script. Check which database that points at before applying.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const SEED_DEMO_SLUGS = [
  "indomie-noodles", "bottled-water", "soft-drink", "campus-rice-meal",
  "blue-ballpoint-pen", "exercise-book", "a4-paper", "project-file",
  "black-white-printing", "colour-printing",
  "tissue-paper", "toothpaste",
  "usb-charging-cable", "wired-earphones", "phone-charger",
];

async function main() {
  const apply = process.argv.includes("--apply");
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) throw new Error("DIRECT_URL is not set.");
  const host = new URL(connectionString).hostname;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const candidates = await prisma.product.findMany({
      where: { slug: { in: SEED_DEMO_SLUGS }, status: "ACTIVE", imageUrl: null },
      select: { id: true, name: true, slug: true, category: { select: { slug: true } }, _count: { select: { orderItems: true } } },
      orderBy: { name: "asc" },
    });
    const skipped = await prisma.product.findMany({
      where: { slug: { in: SEED_DEMO_SLUGS }, status: "ACTIVE", imageUrl: { not: null } },
      select: { name: true },
    });

    console.log(`Database host: ${host}`);
    console.log(apply ? "Mode: APPLY (products will be set to INACTIVE)" : "Mode: dry run (nothing will be written)");
    console.log(`\nDemo products that would be hidden: ${candidates.length}`);
    for (const product of candidates) {
      console.log(`  - ${product.name} [${product.slug}] category=${product.category.slug} past order lines=${product._count.orderItems}`);
    }
    if (skipped.length) {
      console.log(`\nLeft alone because they now have a photo (likely real): ${skipped.map((p) => p.name).join(", ")}`);
    }
    if (!apply || !candidates.length) {
      if (!apply) console.log("\nRe-run with --apply to hide them.");
      return;
    }
    const result = await prisma.product.updateMany({
      where: { id: { in: candidates.map((product) => product.id) }, status: "ACTIVE", imageUrl: null },
      data: { status: "INACTIVE" },
    });
    console.log(`\nHidden ${result.count} product(s). Re-activate any of them from Admin → Products.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Demo product cleanup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
