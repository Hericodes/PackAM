import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StudentNavbar } from "../../../components/student/StudentNavbar";
import { FoodMenu } from "../../../components/food/FoodMenu";
import { getFoodShop, getShopMenu } from "../../../lib/food/shops";
import { db } from "../../../lib/db";
import { readDeliveryTierQuotes } from "../../../lib/delivery-tier-store";
import { deliveryPriceSummary } from "../../../lib/delivery-tiers";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ shop: string }> }): Promise<Metadata> {
  const shop = await getFoodShop((await params).shop);
  return { title: shop ? `${shop.name} · Food` : "Food" };
}

export default async function FoodShopPage({ params }: { params: Promise<{ shop: string }> }) {
  const shop = await getFoodShop((await params).shop);
  if (!shop) notFound();
  const [menu, quotes] = await Promise.all([getShopMenu(shop.id), readDeliveryTierQuotes(db)]);
  return (
    <main className="min-h-screen pb-10">
      <StudentNavbar />
      <div className="packam-container pt-3 sm:pt-8">
        <Link href="/food" className="inline-flex min-h-10 items-center text-sm font-bold text-black/55 hover:text-black">← All food shops</Link>
        <FoodMenu shop={shop} menu={menu} delivery={deliveryPriceSummary(quotes.quotes)} />
      </div>
    </main>
  );
}
