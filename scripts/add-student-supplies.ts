/**
 * Adds the October 2026 notebooks, ID cards, stationery and clothing to the catalogue.
 *
 *   npm run catalogue:add-supplies                                        # dry run: shows the plan, writes nothing
 *   npm run catalogue:add-supplies -- --apply --database-host=<hostname>  # writes, only to the named database
 *
 * Safety:
 * - Never deletes anything and never changes an existing product. A product that already exists (same
 *   slug, a known older slug, or the same name) is reused as it is; if its price differs from the list,
 *   it is reported as a conflict for an admin to resolve in Admin → Products.
 * - New products get the supplied price, no image, no vendor and no stock count (PackAM keeps none).
 *   They are created ACTIVE, which the existing rules allow for any product with a real price, except
 *   items with an open question, which are created INACTIVE (hidden).
 * - Creates the "Clothing" category only if it doesn't exist.
 * - Everything is written in one transaction, re-reading the catalogue first, so a rerun or a concurrent
 *   admin edit can't create duplicates. Running it again creates nothing.
 * - Uses DIRECT_URL like the seed script. --apply refuses to run unless --database-host names that host.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { SUPPLY_CATEGORIES, confirmedWriteTarget, planStudentSupplies, studentSupplyLookup, type SupplyPlan } from "../src/lib/products/student-supplies";

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

function describe(plan: SupplyPlan[]) {
  for (const step of plan) {
    if (step.action === "create") {
      console.log(`  + create   ${step.spec.name} — ${naira(step.spec.price)} · ${SUPPLY_CATEGORIES[step.spec.category].name} · ${step.data.status === "ACTIVE" ? "visible to students" : `HIDDEN: ${step.spec.holdReason}`}`);
    } else if (step.action === "reuse") {
      console.log(`  = reuse    ${step.spec.name} [${step.existing.id}] — already ${naira(step.existing.customerPrice)}, ${step.existing.status.toLowerCase()}; left unchanged`);
    } else {
      console.log(`  ! conflict ${step.spec.name} [${step.existing.id}] — ${step.reason}. Left unchanged; confirm the price, then edit it in Admin → Products.`);
    }
  }
  const count = (action: SupplyPlan["action"]) => plan.filter((step) => step.action === action).length;
  console.log(`\n${count("create")} to create, ${count("reuse")} already present, ${count("conflict")} price conflicts.`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) throw new Error("DIRECT_URL is not set.");
  const host = new URL(connectionString).hostname;
  if (apply && !confirmedWriteTarget(host, process.argv)) {
    throw new Error(`Refusing to write: pass --database-host=${host} to confirm this is the database you mean to change.`);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    console.log(`Database host: ${host}`);
    console.log(apply ? "Mode: APPLY" : "Mode: dry run (nothing will be written)");

    const categories = await prisma.category.findMany({ where: { slug: { in: Object.values(SUPPLY_CATEGORIES).map((category) => category.slug) } }, select: { id: true, slug: true, isActive: true } });
    for (const category of Object.values(SUPPLY_CATEGORIES)) {
      const found = categories.find((row) => row.slug === category.slug);
      console.log(found ? `Category ${category.name}: exists${found.isActive ? "" : " but is INACTIVE (students won't see its products)"}` : `Category ${category.name}: will be created`);
    }
    const idFor = (key: keyof typeof SUPPLY_CATEGORIES) => categories.find((row) => row.slug === SUPPLY_CATEGORIES[key].slug)?.id ?? `(new ${SUPPLY_CATEGORIES[key].slug})`;

    const lookup = studentSupplyLookup();
    const where = { OR: [{ slug: { in: lookup.slugs } }, ...lookup.names.map((name) => ({ name: { equals: name, mode: "insensitive" as const } }))] };
    const select = { id: true, name: true, slug: true, categoryId: true, status: true, customerPrice: true, imageUrl: true } as const;
    console.log("");
    describe(planStudentSupplies(await prisma.product.findMany({ where, select }), { academic: idFor("academic"), clothing: idFor("clothing") }));

    if (!apply) {
      console.log(`\nNothing written. To apply to this database: npm run catalogue:add-supplies -- --apply --database-host=${host}`);
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const ids = {} as Record<keyof typeof SUPPLY_CATEGORIES, string>;
      for (const key of Object.keys(SUPPLY_CATEGORIES) as Array<keyof typeof SUPPLY_CATEGORIES>) {
        const { name, slug } = SUPPLY_CATEGORIES[key];
        ids[key] = (await tx.category.upsert({ where: { slug }, update: {}, create: { name, slug }, select: { id: true } })).id;
      }
      const plan = planStudentSupplies(await tx.product.findMany({ where, select }), ids);
      const rows: Array<{ id: string; name: string; price: number; status: string }> = [];
      for (const step of plan) {
        if (step.action !== "create") continue;
        const product = await tx.product.create({ data: step.data, select: { id: true, name: true, customerPrice: true, status: true } });
        rows.push({ id: product.id, name: product.name, price: product.customerPrice, status: product.status });
      }
      return rows;
    }, { isolationLevel: "Serializable", timeout: 30_000 });

    console.log(`\nCreated ${created.length} products:`);
    for (const row of created) console.log(`  ${row.id}  ${row.name}  ${naira(row.price)}  ${row.status}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Adding student supplies failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
