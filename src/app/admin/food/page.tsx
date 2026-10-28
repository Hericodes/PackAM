import Link from "next/link";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";
import { FoodShopForm } from "../../../components/admin/food/FoodShopForm";
import { StatusBadge } from "../../../components/ui/StatusBadge";

export default async function AdminFoodPage() {
  await requireRole("ADMIN");
  // Food shops: anything set up for Food, plus restaurant vendors that could be.
  const shops = await db.vendor.findMany({
    where: { OR: [{ listedInFood: true }, { type: "RESTAURANT" }, { menuItems: { some: {} } }] },
    orderBy: [{ listedInFood: "desc" }, { name: "asc" }],
    select: { id: true, name: true, location: true, isOpen: true, listedInFood: true, status: true, _count: { select: { menuItems: true } }, menuItems: { where: { status: "ACTIVE" }, select: { id: true } } },
  });

  return (
    <main className="min-h-screen">
      <div className="packam-container py-8 sm:py-10">
        <p className="text-xs font-black uppercase tracking-[0.15em] text-black/40">Catalogue</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Food shops</h1>
        <p className="mt-2 max-w-2xl text-sm text-black/55">Set up each shop’s menu, then open it and show it in Food. Students only see shops that are shown in Food, and can only order while a shop is open.</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-label="Food shops" className="space-y-2">
            {shops.map((shop) => (
              <Link key={shop.id} href={`/admin/food/${shop.id}`} className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-black/20">
                <div className="min-w-0 flex-1">
                  <p className="font-black">{shop.name}</p>
                  <p className="text-xs text-black/55">{shop.location ?? "No location set"} · {shop.menuItems.length} of {shop._count.menuItems} menu items available</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge label={shop.listedInFood ? "Shown in Food" : "Hidden"} tone={shop.listedInFood ? "success" : "neutral"} />
                  <StatusBadge label={shop.isOpen ? "Open" : "Closed"} tone={shop.isOpen ? "success" : "warning"} />
                  {shop.status !== "ACTIVE" && <StatusBadge label="Vendor inactive" tone="danger" />}
                </div>
              </Link>
            ))}
            {!shops.length && <p className="rounded-2xl border border-dashed border-black/15 bg-white p-6 text-sm text-black/60">No food shops yet. Add the first one — it starts closed and hidden until its menu is ready.</p>}
          </section>
          <aside>
            <h2 className="mb-3 text-lg font-black">Add food shop</h2>
            <FoodShopForm />
          </aside>
        </div>
      </div>
    </main>
  );
}
