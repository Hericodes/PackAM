import type { Metadata } from "next";
import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { GatewayHeader } from "../components/student/GatewayHeader";
import { Icon, type IconName } from "../components/ui/Icon";
import { ACCOUNT_DELETED_COOKIE } from "../lib/account/deletion-policy";
import { GREETING_COOKIE, parseGreetingIndex, pickHomeGreeting } from "../lib/home-greetings";
import { RememberGreeting } from "../components/student/RememberGreeting";
import { listFoodShops } from "../lib/food/shops";
import { productImageDeliveryUrl } from "../lib/cloudinary-url";
import { orderingHoursFromEnv, orderingHoursLabel } from "../lib/ordering-hours";

type Service = { id: string; icon: IconName; title: string; body: string; href: string };

/** Food leads (it's what most students come for); these two sit side by side under it. */
const MORE_SERVICES: Service[] = [
  { id: "order", icon: "shop", title: "Order Stuff", body: "Provisions, drinks, stationery and essentials.", href: "/search" },
  { id: "printing", icon: "printer", title: "Printing", body: "Upload, pay, and we bring your prints.", href: "/printing" },
];

const STEPS = [
  { icon: "🍲", title: "Pick", body: "Food from a campus shop, or anything from the store." },
  { icon: "💳", title: "Pay", body: "See the full total, delivery included, before you pay." },
  { icon: "🛵", title: "Relax", body: "A runner brings it to you anywhere on OOU main campus." },
];

type FoodShopTile = { id: string; name: string; imageUrl: string | null; isOpen: boolean };

/** Up to four shops for the food card, open ones first. The home page never fails because of them. */
async function foodShopsForHome(): Promise<{ shops: FoodShopTile[]; openCount: number }> {
  try {
    const shops = await listFoodShops();
    return { shops: shops.slice(0, 4).map(({ id, name, imageUrl, isOpen }) => ({ id, name, imageUrl, isOpen })), openCount: shops.filter((shop) => shop.isOpen).length };
  } catch {
    return { shops: [], openCount: 0 };
  }
}

function FoodHero({ shops, openCount }: { shops: FoodShopTile[]; openCount: number }) {
  return (
    <section aria-labelledby="home-food" className="relative overflow-hidden rounded-[28px] bg-[#1f1300] text-white shadow-[0_28px_60px_-30px_rgba(135,90,0,0.9)]">
      {/* Warm glow and a little plate of emoji in the corner: decoration only. */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#feb80a]/25 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-[#ff6a00]/15 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute right-4 top-4 select-none text-right text-3xl leading-none sm:right-7 sm:top-6 sm:text-5xl">
        <span className="inline-block rotate-[-8deg]">🍛</span><span className="ml-1 inline-block rotate-[10deg]">🍗</span>
        <br />
        <span className="mr-3 inline-block rotate-[6deg] sm:mr-5">🥘</span>
      </div>

      <div className="relative p-5 sm:p-8">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#feb80a]">
          <Icon name="food" className="h-3.5 w-3.5" /> Food
        </p>
        <h2 id="home-food" className="mt-3 max-w-[11ch] sm:max-w-[15ch] text-[clamp(1.75rem,7vw,2.6rem)] font-black leading-[1.05] tracking-[-0.03em]">Hungry? Order food.</h2>
        <p className="mt-2 max-w-md text-[0.9375rem] leading-6 text-white/75 sm:text-base">
          Jollof, swallow, shawarma and more from campus food shops, brought hot to wherever you are on campus.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/food" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#feb80a] px-6 text-base font-black text-black shadow-[0_10px_24px_-12px_rgba(254,184,10,0.9)] transition hover:bg-[#ffc933] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white">
            Order food now <Icon name="arrowUpRight" className="h-5 w-5" />
          </Link>
          {openCount > 0 && (
            <p className="inline-flex items-center gap-2 text-sm font-bold text-white/80">
              <span aria-hidden="true" className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-[#4ade80] opacity-75 motion-safe:animate-ping" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#4ade80]" /></span>
              {openCount} {openCount === 1 ? "shop" : "shops"} open now
            </p>
          )}
        </div>

        {shops.length > 0 && (
          <ul aria-label="Food shops" className="-mx-5 mt-6 flex gap-2.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            {shops.map((shop) => (
              <li key={shop.id} className="w-36 shrink-0 sm:w-auto">
                <Link href={`/food/${shop.id}`} className={`group block overflow-hidden rounded-2xl bg-white/[0.07] ring-1 ring-white/10 transition hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${shop.isOpen ? "" : "opacity-60"}`}>
                  <div className="relative aspect-[4/3] bg-white/5">
                    {shop.imageUrl
                      ? <Image src={productImageDeliveryUrl(shop.imageUrl)} alt="" fill sizes="(min-width: 640px) 160px, 144px" className="object-cover transition duration-300 group-hover:scale-105" />
                      : <span aria-hidden="true" className="flex h-full items-center justify-center text-4xl">🍲</span>}
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-sm font-black">{shop.name}</p>
                    <p className={`mt-0.5 text-xs font-bold ${shop.isOpen ? "text-[#4ade80]" : "text-white/50"}`}>{shop.isOpen ? "Open" : "Closed"}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const titleId = `service-${service.id}`;
  return (
    <Link
      href={service.href}
      aria-labelledby={titleId}
      className="group flex h-full items-center gap-4 rounded-[22px] border border-black/8 bg-white p-4 shadow-[0_1px_2px_rgba(8,8,8,0.04)] transition-[box-shadow,border-color] duration-150 hover:border-black/20 hover:shadow-(--shadow-soft) focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-black sm:p-5"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff4c7] text-[#875a00]">
        <Icon name={service.icon} className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-lg font-black leading-snug tracking-[-0.01em]">{service.title}</h2>
        <p className="mt-0.5 text-sm leading-5 text-black/60">{service.body}</p>
      </div>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
        <Icon name="arrowUpRight" className="h-5 w-5" />
      </span>
    </Link>
  );
}

// The home page's canonical address is the www domain, whichever host served it (metadataBase in the root layout).
export const metadata: Metadata = { alternates: { canonical: "/" } };

type HomePageProps = { searchParams: Promise<{ accountDeleted?: string }> };

export default async function HomePage({ searchParams }: HomePageProps) {
  // Where a deleted account lands after signing out (Settings → Delete account). Only the browser that just deleted
  // has the cookie, so the query alone shows nothing.
  const [params, cookieStore, food] = await Promise.all([searchParams, cookies(), foodShopsForHome()]);
  const accountDeleted = params.accountDeleted === "1" && cookieStore.get(ACCOUNT_DELETED_COOKIE)?.value === "1";
  // A different greeting each visit, never the last one this browser saw. Picked on the server (this page renders per
  // request), so there's no flash; the browser then remembers which one it got.
  const { index: greetingIndex, greeting } = pickHomeGreeting(Math.random, parseGreetingIndex(cookieStore.get(GREETING_COOKIE)?.value));
  const hours = orderingHoursLabel(orderingHoursFromEnv());
  return (
    <div className="flex min-h-svh flex-col text-black">
      <GatewayHeader />
      <RememberGreeting index={greetingIndex} />

      <main className="packam-container flex-1 py-7 sm:py-12">
        <div className="mx-auto w-full max-w-3xl">
          {accountDeleted && (
            <p role="status" className="mb-6 rounded-2xl bg-[#e9f8ee] px-4 py-3 text-center text-sm font-semibold leading-6 text-[#0f5f2c]">
              Your PackAM account has been deleted. Thanks for using PackAM.
            </p>
          )}
          <div className="text-center">
            <h1 className="text-balance text-[clamp(1.75rem,6vw,2.5rem)] font-black leading-[1.1] tracking-[-0.03em]">{greeting.title}</h1>
            <p className="pk-muted mt-2 text-balance text-base sm:text-lg">{greeting.subtitle}</p>
          </div>

          <div className="mt-7 sm:mt-10">
            <FoodHero shops={food.shops} openCount={food.openCount} />
          </div>

          <ul className="mt-3 grid gap-3 sm:mt-4 sm:grid-cols-2 sm:gap-4" aria-label="More from PackAM">
            {MORE_SERVICES.map((service) => (
              <li key={service.id}>
                <ServiceCard service={service} />
              </li>
            ))}
          </ul>

          <section aria-labelledby="home-how" className="mt-10 sm:mt-14">
            <h2 id="home-how" className="text-center text-xs font-black uppercase tracking-[0.14em] text-black/45">How PackAM works</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex items-start gap-3 rounded-2xl bg-white/70 p-4 ring-1 ring-black/5 sm:flex-col sm:gap-2">
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#fff4c7] text-2xl">{step.icon}</span>
                  <div>
                    <p className="text-sm font-black"><span className="text-black/40">{index + 1}.</span> {step.title}</p>
                    <p className="mt-0.5 text-sm leading-5 text-black/60">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-center text-xs font-semibold text-black/50">We take orders {hours}.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
