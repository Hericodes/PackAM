import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { StudentNavbar } from "../../components/student/StudentNavbar";
import { listFoodShops } from "../../lib/food/shops";
import { CHECKOUT_DELIVERY_FEE } from "../../lib/checkout-pricing";
import { productImageDeliveryUrl } from "../../lib/cloudinary-url";

export const metadata: Metadata = { title: "Food" };
export const dynamic = "force-dynamic";

export default async function FoodPage() {
  const shops = await listFoodShops();
  return (
    <main className="min-h-screen pb-10">
      <StudentNavbar />
      <div className="packam-container pt-3 sm:pt-8">
        <p className="pk-eyebrow">Food</p>
        <h1 className="pk-page-title mt-1 max-sm:text-[1.625rem] sm:mt-2">Wetin you wan chop?</h1>
        <p className="pk-muted mt-1.5 text-[0.8125rem] leading-5 sm:text-base sm:leading-6">Pick a shop, choose your food, and your runner brings it. Delivery is ₦{CHECKOUT_DELIVERY_FEE.toLocaleString()}.</p>

        {shops.length === 0 ? (
          <div className="pk-empty mt-5 px-4 py-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff4c7] text-2xl" aria-hidden="true">🍲</span>
            <h2 className="mt-3 text-lg font-black">No food shops yet</h2>
            <p className="pk-muted mt-1 max-w-md text-sm leading-6">Food shops will show up here once they’re on PackAM. Check back soon.</p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:mt-6 sm:grid-cols-2 lg:grid-cols-3" aria-label="Food shops">
            {shops.map((shop) => (
              <li key={shop.id}>
                <Link href={`/food/${shop.id}`} className={`group flex h-full gap-3 rounded-[20px] border border-black/[0.07] bg-white p-2.5 transition hover:border-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:flex-col sm:p-0 ${shop.isOpen ? "" : "opacity-80"}`}>
                  <div className="pk-media pk-media-amber relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-2xl sm:aspect-[16/9] sm:h-auto sm:w-full sm:rounded-b-none sm:rounded-t-[20px]">
                    {shop.imageUrl
                      ? <Image src={productImageDeliveryUrl(shop.imageUrl)} alt="" fill sizes="(min-width: 640px) 33vw, 88px" className="object-cover" />
                      : <span className="flex h-full items-center justify-center text-3xl sm:text-5xl" aria-hidden="true">🍲</span>}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col sm:p-4 sm:pt-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-black leading-5">{shop.name}</h2>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-black ${shop.isOpen ? "bg-[#e9f8ee] text-[#16803c]" : "bg-black/6 text-black/60"}`}>{shop.isOpen ? "Open" : "Closed"}</span>
                    </div>
                    {shop.description && <p className="mt-1 line-clamp-2 text-xs leading-[1.125rem] text-black/60 sm:text-sm sm:leading-5">{shop.description}</p>}
                    {shop.sections.length > 0 && <p className="mt-1.5 truncate text-xs font-semibold text-[#875a00]">{shop.sections.join(" · ")}</p>}
                    <p className="mt-auto pt-1.5 text-xs text-black/50">{[shop.location, shop.itemCount ? `${shop.itemCount} on the menu` : "Menu coming soon"].filter(Boolean).join(" · ")}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
