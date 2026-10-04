import Link from "next/link";
import { StudentNavbar } from "../components/student/StudentNavbar";
import { CategoryCard } from "../components/student/CategoryCard";
import { ProductCard } from "../components/student/ProductCard";
import { siteConfig } from "../config/site";
import { db } from "../lib/db";
const categoryEmojis: Record<string, string> = {
  "food-drinks": "🍔",
  "academic-materials": "📚",
  printing: "🖨️",
  "everyday-essentials": "🧴",
  "phones-accessories": "📱",
};
export default async function HomePage() {
  const products = await db.product.findMany({
    where: {
      status: "ACTIVE",
      category: {
        isActive: true,
      },
    },
    select: {
      id: true,
      name: true,
      customerPrice: true,
      imageUrl: true,
      category: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 8,
  });
  return (
    <main className="min-h-screen bg-[#fffdf7] text-black">
      <StudentNavbar />
      {/* HERO */}
      <section className="overflow-hidden">
        <div className="packam-container grid items-center gap-8 py-8 sm:gap-12 sm:py-12 lg:min-h-[620px] lg:grid-cols-[0.95fr_1.05fr] lg:py-16">
          {/* LEFT */}
          <div className="relative z-10">
            <div className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-black shadow-sm sm:mb-6">
              <span>👀</span>
              OOU students, we got you.
            </div>
            <h1 className="max-w-3xl text-[clamp(2.75rem,11vw,3.7rem)] font-black leading-[0.95] tracking-[-0.045em] sm:text-6xl lg:text-[5.5rem]">
              Need something?
              <br />
              <span className="text-[#875a00]">WE PackAM.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base font-medium leading-7 text-black/60 sm:mt-7 sm:text-xl sm:leading-8">
              Food? Notes? Charger? Something random?
              <br />
              <span className="font-black text-black">
                Just find am. 😂
              </span>
            </p>
            {/* SEARCH ENTRY */}
            <Link
              href="/search"
              className="group mt-6 flex min-h-16 max-w-2xl items-center gap-3 rounded-[1.25rem] border border-black/10 bg-white p-2 pl-4 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:border-black/20 hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black sm:mt-8 sm:gap-4 sm:pl-5"
            >
              <span
                aria-hidden="true"
                className="text-2xl text-black/65"
              >
                ⌕
              </span>
              <span className="flex-1 text-left text-base font-semibold text-black/65 sm:text-lg">
                What do you need? 👀
              </span>
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#feb80a] text-xl font-black transition group-hover:scale-105"
              >
                →
              </span>
            </Link>
          </div>
        </div>
      </section>
      {/* SHOPPING INTRO */}
      <section className="border-y border-black/5 bg-[#fff4cf]">
        <div className="packam-container py-7 sm:py-9">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-black/55">
                Start here
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.03em] sm:text-3xl">
                What are you looking for today? 👀
              </h2>
            </div>
            <p className="max-w-md text-sm font-medium leading-6 text-black/55 sm:text-right">
              Pick a category or search for exactly what you need.
            </p>
          </div>
        </div>
      </section>
      {/* CATEGORIES */}
      <section className="py-10 sm:py-14">
        <div className="packam-container">
          <div className="mb-5 flex items-end justify-between gap-4 sm:mb-7">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-black/50">
                Browse
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.03em] sm:text-3xl">
                Pick your lane.
              </h2>
            </div>
            <Link
              href="/search"
              className="hidden text-sm font-black underline underline-offset-4 sm:block"
            >
              View all →
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 sm:gap-4">
            {siteConfig.categories.map((category) => (
              <CategoryCard
                key={category.slug}
                name={category.name}
                slug={category.slug}
                emoji={categoryEmojis[category.slug] ?? "📦"}
              />
            ))}
          </div>
        </div>
      </section>
      {/* PRODUCTS */}
      <section className="bg-[#f7f5ee] py-10 sm:py-16">
        <div className="packam-container">
          <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-black/50">
                Marketplace
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.03em] sm:text-3xl">
                People dey order these 👀
              </h2>
              <p className="mt-1 text-sm font-medium text-black/55">
                Apparently, everybody needs something.
              </p>
            </div>
            <Link
              href="/search"
              className="hidden text-sm font-black underline underline-offset-4 sm:block"
            >
              See all →
            </Link>
          </div>
          {products.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  id={product.id}
                  name={product.name}
                  price={product.customerPrice}
                  image={product.imageUrl}
                  category={product.category.name}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-black/5 bg-white px-5 py-10 text-center sm:rounded-[2rem] sm:px-6 sm:py-16">
              <div className="text-5xl">📦</div>
              <h3 className="mt-5 text-xl font-black">
                Nothing here yet. 👀
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-black/70">
We&apos;re still stocking the marketplace. Check back soon or
                tell us what you&apos;re looking for.
              </p>
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/search"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#feb80a] px-6 py-3 text-sm font-black text-black transition hover:bg-[#f5a900] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
                >
                  Find something →
                </Link>
                <Link
                  href="/product-requests"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-black/10 bg-white px-6 py-3 text-sm font-black text-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
                >
                  Request a product
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
      {/* REQUEST PRODUCT */}
      <section className="py-10 sm:py-16">
        <div className="packam-container">
          <div className="relative overflow-hidden rounded-[1.5rem] bg-black px-5 py-9 text-white sm:rounded-[2rem] sm:px-12 sm:py-14">
            <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#feb80a]" />
            <div className="absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-white/5" />
            <div className="relative z-10 max-w-2xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#feb80a]">
Can&apos;t find it?
              </p>
              <h2 className="mt-3 text-3xl font-black leading-tight tracking-[-0.04em] sm:text-5xl">
                No wahala.
                <br />
                Tell us what you need. 🫡
              </h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/60">
Don&apos;t see what you&apos;re looking for? Send us the
product details and we&apos;ll check if we can source it.
              </p>
              <Link
                href="/product-requests"
                className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-[#feb80a] px-6 py-3 text-sm font-black text-black transition hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:mt-7"
              >
                Request a Product →
              </Link>
            </div>
            <div className="absolute bottom-8 right-8 hidden rotate-[-8deg] rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm lg:block">
              <p className="text-sm font-black">
                “Abeg find this one.”
              </p>
              <p className="mt-1 text-xs text-white/50">
                — every student ever 😂
              </p>
            </div>
          </div>
        </div>
      </section>
      {/* SIMPLE CLOSING */}
      <section className="pb-12 sm:pb-16">
        <div className="packam-container">
          <div className="border-t border-black/10 pt-8 text-center">
            <p className="text-xl font-black sm:text-2xl">
              Need something?
            </p>
            <p className="mt-1 text-sm font-medium text-black/50">
              Search am. Order am. We PackAM. 📦
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}