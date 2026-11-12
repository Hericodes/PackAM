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

type Service = { id: string; icon: IconName; title: string; body: string; href: string; cta: string; tone: string; iconTone: string };

/**
 * The two services next to Food. All three are visible at once (above the fold on a phone): Food is the bigger,
 * darker tile, Order Stuff and Printing sit right beside it (on phones, side by side under it).
 */
const MORE_SERVICES: Service[] = [
  { id: "order", icon: "shop", title: "Order Stuff", body: "Provisions, drinks, stationery and essentials.", href: "/search", cta: "Shop now", tone: "bg-[#feb80a] text-black", iconTone: "bg-black text-[#feb80a]" },
  { id: "printing", icon: "printer", title: "Printing", body: "Upload your document, pay, and we bring the prints.", href: "/printing", cta: "Print now", tone: "bg-[#e9f1ff] text-black ring-1 ring-[#1d4ed8]/10", iconTone: "bg-[#1d4ed8] text-white" },
];

const STEPS = [
  { icon: "🛍️", title: "Pick", body: "Food from a campus shop, things from the store, or a document to print." },
  { icon: "💳", title: "Pay", body: "See the full total, delivery included, before you pay." },
  { icon: "🛵", title: "Relax", body: "A runner brings it to you anywhere on OOU main campus." },
];

type FoodShopTile = { id: string; name: string; imageUrl: string | null; isOpen: boolean };

/** Up to six shops for the "open now" row, open ones first. The home page never fails because of them. */
async function foodShopsForHome(): Promise<{ shops: FoodShopTile[]; openCount: number }> {
  try {
    const shops = await listFoodShops();
    return { shops: shops.slice(0, 6).map(({ id, name, imageUrl, isOpen }) => ({ id, name, imageUrl, isOpen })), openCount: shops.filter((shop) => shop.isOpen).length };
  } catch {
    return { shops: [], openCount: 0 };
  }
}

/** The Food tile: dark and warm, the biggest of the three, but short enough that the other two show beside it. */
function FoodHero({ openCount }: { openCount: number }) {
  return (
    <Link
      href="/food"
      aria-labelledby="home-food"
      className="group relative flex h-full min-h-44 flex-col overflow-hidden rounded-[26px] bg-[#1f1300] p-5 text-white shadow-[0_24px_50px_-30px_rgba(135,90,0,0.9)] transition hover:-translate-y-0.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-black sm:min-h-72 sm:p-7"
    >
      {/* Warm glow and a little plate of emoji: decoration only. */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#feb80a]/25 blur-3xl" />
      <span aria-hidden="true" className="pointer-events-none absolute right-4 top-4 select-none text-right text-3xl leading-none sm:right-6 sm:top-6 sm:text-5xl">
        <span className="inline-block rotate-[-8deg]">🍛</span><span className="ml-1 inline-block rotate-[10deg]">🍗</span>
        <br className="hidden sm:block" />
        <span className="hidden rotate-[6deg] sm:mr-5 sm:inline-block">🥘</span>
      </span>

      <span className="relative inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[0.6875rem] font-black uppercase tracking-[0.12em] text-[#feb80a]">
        <Icon name="food" className="h-3.5 w-3.5" /> Food
      </span>
      <h2 id="home-food" className="relative mt-3 max-w-[13ch] text-[clamp(1.5rem,6.5vw,2.4rem)] font-black leading-[1.05] tracking-[-0.03em]">Hungry? Order food.</h2>
      <p className="relative mt-1.5 max-w-sm text-sm leading-6 text-white/75 sm:mt-2 sm:text-base">Jollof, swallow, shawarma and more from campus food shops.</p>

      <span className="relative mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4">
        <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#feb80a] px-5 text-sm font-black text-black transition group-hover:bg-[#ffc933] sm:min-h-12 sm:px-6 sm:text-base">
          Order food <Icon name="arrowUpRight" className="h-5 w-5" />
        </span>
        {openCount > 0 && (
          <span className="inline-flex items-center gap-2 text-sm font-bold text-white/80">
            <span aria-hidden="true" className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-[#4ade80] opacity-75 motion-safe:animate-ping" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#4ade80]" /></span>
            {openCount} {openCount === 1 ? "shop" : "shops"} open
          </span>
        )}
      </span>
    </Link>
  );
}

function ServiceTile({ service }: { service: Service }) {
  const titleId = `service-${service.id}`;
  return (
    <Link
      href={service.href}
      aria-labelledby={titleId}
      className={`group flex h-full min-h-40 flex-col rounded-[26px] p-4 shadow-[0_1px_2px_rgba(8,8,8,0.04)] transition hover:-translate-y-0.5 hover:shadow-(--shadow-soft) focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-black sm:min-h-0 sm:p-5 ${service.tone}`}
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${service.iconTone}`}>
        <Icon name={service.icon} className="h-5 w-5" />
      </span>
      <h2 id={titleId} className="mt-3 text-lg font-black leading-tight tracking-[-0.01em] sm:text-xl">{service.title}</h2>
      <p className="mt-1 text-[0.8125rem] leading-5 text-black/65 sm:text-sm">{service.body}</p>
      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-black">
        {service.cta} <Icon name="arrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** Food shops as a scrolling row under the three services: photos make it easy to pick a place to eat. */
function OpenShops({ shops }: { shops: FoodShopTile[] }) {
  if (!shops.length) return null;
  return (
    <section aria-labelledby="home-shops" className="mt-7 sm:mt-9">
      <div className="flex items-end justify-between gap-3">
        <h2 id="home-shops" className="text-base font-black sm:text-lg">Food shops on PackAM</h2>
        <Link href="/food" className="text-sm font-bold text-black/60 underline-offset-4 hover:text-black hover:underline">See all</Link>
      </div>
      <ul className="-mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6 [&::-webkit-scrollbar]:hidden">
        {shops.map((shop) => (
          <li key={shop.id} className="w-36 shrink-0 sm:w-auto">
            <Link href={`/food/${shop.id}`} className={`group block overflow-hidden rounded-2xl bg-white ring-1 ring-black/8 transition hover:ring-black/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${shop.isOpen ? "" : "opacity-60"}`}>
              <div className="pk-media pk-media-amber relative aspect-[4/3]">
                {shop.imageUrl
                  ? <Image src={productImageDeliveryUrl(shop.imageUrl)} alt="" fill sizes="(min-width: 1024px) 160px, (min-width: 640px) 33vw, 144px" className="object-cover transition duration-300 group-hover:scale-105" />
                  : <span aria-hidden="true" className="flex h-full items-center justify-center text-4xl">🍲</span>}
              </div>
              <div className="p-2.5">
                <p className="truncate text-sm font-black">{shop.name}</p>
                <p className={`mt-0.5 text-xs font-bold ${shop.isOpen ? "text-[#16803c]" : "text-black/45"}`}>{shop.isOpen ? "Open now" : "Closed"}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
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

      <main className="packam-container flex-1 py-5 sm:py-10">
        <div className="mx-auto w-full max-w-4xl">
          {accountDeleted && (
            <p role="status" className="mb-6 rounded-2xl bg-[#e9f8ee] px-4 py-3 text-center text-sm font-semibold leading-6 text-[#0f5f2c]">
              Your PackAM account has been deleted. Thanks for using PackAM.
            </p>
          )}
          <div className="text-center sm:text-left">
            <h1 className="text-balance text-[clamp(1.5rem,5.5vw,2.25rem)] font-black leading-[1.1] tracking-[-0.03em]">{greeting.title}</h1>
            <p className="pk-muted mt-1.5 text-balance text-sm sm:text-base">{greeting.subtitle}</p>
          </div>

          {/* Food, Order Stuff and Printing together: food is the big tile, the other two right beside it. */}
          <ul aria-label="PackAM services" className="mt-5 grid grid-cols-2 gap-3 sm:mt-7 sm:grid-cols-3 sm:grid-rows-2 sm:gap-4">
            <li className="col-span-2 sm:row-span-2">
              <FoodHero openCount={food.openCount} />
            </li>
            {MORE_SERVICES.map((service) => (
              <li key={service.id}>
                <ServiceTile service={service} />
              </li>
            ))}
          </ul>

          <OpenShops shops={food.shops} />

          <section aria-labelledby="home-how" className="mt-9 sm:mt-12">
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
