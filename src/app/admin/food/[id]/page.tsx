import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth-guard";
import { db } from "../../../../lib/db";
import { FoodShopForm } from "../../../../components/admin/food/FoodShopForm";
import { FoodMenuManager, type AdminMenuItem } from "../../../../components/admin/food/FoodMenuManager";
import type { FoodRole } from "../../../../lib/food/plate";

export default async function AdminFoodShopPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const shop = await db.vendor.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, location: true, imageUrl: true, isOpen: true, listedInFood: true,
      menuItems: { orderBy: [{ menuSection: "asc" }, { name: "asc" }], select: { id: true, name: true, foodRole: true, customerPrice: true, menuSection: true, description: true, imageUrl: true, maxPerPlate: true, status: true } } },
  });
  if (!shop) notFound();
  const items: AdminMenuItem[] = shop.menuItems.filter((item) => item.foodRole).map((item) => ({
    id: item.id, name: item.name, role: item.foodRole as FoodRole, price: item.customerPrice, section: item.menuSection,
    description: item.description, imageUrl: item.imageUrl, maxPerPlate: item.maxPerPlate, available: item.status === "ACTIVE",
  }));

  return (
    <main className="min-h-screen">
      <div className="packam-container max-w-4xl py-8 sm:py-10">
        <Link href="/admin/food" className="inline-flex min-h-11 items-center text-sm font-black text-black/50 hover:text-black">← All food shops</Link>
        <h1 className="mt-2 text-3xl font-black tracking-tight">{shop.name}</h1>
        <div className="mt-5"><FoodShopForm shop={{ ...shop, availableItems: items.filter((item) => item.available).length }} /></div>
        <h2 className="mt-8 text-xl font-black">Menu</h2>
        <p className="mt-1 text-sm text-black/55">Prices are what students pay. Changing a price or hiding an item never changes orders already paid for.</p>
        <div className="mt-4"><FoodMenuManager shopId={shop.id} items={items} /></div>
      </div>
    </main>
  );
}
