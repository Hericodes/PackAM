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
              <span className="text-[#feb80a]">WE PackAM.</span>
            </h1>

            <p className="mt-5 max-w-xl text-base font-medium leading-7 text-black/60 sm:mt-7 sm:text-xl sm:leading-8">
              Food? Notes? Charger? Something random?
              <br />
              <span className="font-black text-black">
                Just find am. 😂
              </span>
            </p>

            {/* SEARCH */}
            <Link
              href="/search"
              className="group mt-6 flex min-h-16 max-w-2xl items-center gap-3 rounded-[1.25rem] border border-black/10 bg-white p-2 pl-4 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:border-black/20 hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black sm:mt-8 sm:gap-4 sm:pl-5"
            >
              <span aria-hidden="true" className="text-2xl text-black/65">⌕</span>

              <span className="flex-1 text-left text-base font-semibold text-black/65 sm:text-lg">
                What do you need? 👀
              </span>

              <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#feb80a] text-xl font-black transition group-hover:scale-105">
                →
              </span>
            </Link>

            <p className="mt-3 pl-1 text-xs font-semibold leading-5 text-black/50 sm:text-sm">
              Try “jollof”, “BIO 101 note”, “charger”, “print”...
            </p>
          </div>

          {/* RIGHT — PACKAM VISUAL */}
          <div className="relative min-h-[320px] sm:min-h-[430px] lg:min-h-[500px]">
            {/* Main background shape */}
            <div className="absolute inset-4 rotate-[-2deg] rounded-[3rem] bg-[#feb80a] sm:inset-0" />

            {/* Decorative circles */}
            <div className="absolute -right-4 -top-4 h-28 w-28 rounded-full bg-[#ffd968] sm:-right-8 sm:-top-8 sm:h-36 sm:w-36" />
            <div className="absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-[#ffe89c] sm:-bottom-8 sm:-left-8 sm:h-32 sm:w-32" />

            {/* Floating note 1 */}
            <div className="absolute left-1 top-5 z-20 rotate-[-7deg] rounded-2xl border-2 border-black bg-white px-3 py-2 shadow-[4px_4px_0_#000] sm:left-0 sm:top-8 sm:px-4 sm:py-3 sm:shadow-[5px_5px_0_#000]">
              <p className="text-sm font-black">I need this.</p>
              <p className="text-lg">👀</p>
            </div>

            {/* Floating note 2 */}
            <div className="absolute right-0 top-14 z-20 rotate-[5deg] rounded-2xl border-2 border-black bg-white px-3 py-2 shadow-[4px_4px_0_#000] sm:top-20 sm:px-4 sm:py-3 sm:shadow-[5px_5px_0_#000]">
              <p className="text-sm font-black">Abeg help me</p>
              <p className="text-sm font-black">find this. 😭</p>
            </div>

            {/* Main package */}
            <div className="absolute left-1/2 top-1/2 z-10 flex h-[210px] w-[180px] -translate-x-1/2 -translate-y-1/2 rotate-[-3deg] items-center justify-center rounded-[1.6rem] border-4 border-black bg-[#f5a900] shadow-[8px_9px_0_#000] sm:h-[310px] sm:w-[260px] sm:rounded-[2rem] sm:border-[5px] sm:shadow-[12px_14px_0_#000]">
              <div className="text-center">
                <div className="text-6xl sm:text-7xl">📦</div>

                <p className="mt-3 text-3xl font-black tracking-[-0.05em] sm:mt-4 sm:text-4xl">
                  PackAM
                </p>

                <p className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] sm:text-xs sm:tracking-[0.2em]">
                  We go find am.
                </p>
              </div>
            </div>

            {/* Food */}
            <div className="absolute bottom-10 left-2 z-20 flex h-[4.5rem] w-[4.5rem] rotate-[-8deg] items-center justify-center rounded-3xl border-2 border-black bg-white text-4xl shadow-[4px_4px_0_#000] sm:bottom-12 sm:left-10 sm:h-24 sm:w-24 sm:text-5xl sm:shadow-[5px_5px_0_#000]">
              🍛
            </div>

            {/* Book */}
            <div className="absolute right-3 top-2 z-20 flex h-[4.5rem] w-[4.5rem] rotate-[8deg] items-center justify-center rounded-3xl border-2 border-black bg-white text-4xl shadow-[4px_4px_0_#000] sm:right-12 sm:top-4 sm:h-24 sm:w-24 sm:text-5xl sm:shadow-[5px_5px_0_#000]">
              📚
            </div>

            {/* Charger */}
            <div className="absolute bottom-5 right-2 z-20 flex h-16 w-16 rotate-[8deg] items-center justify-center rounded-3xl border-2 border-black bg-white text-3xl shadow-[4px_4px_0_#000] sm:bottom-6 sm:right-16 sm:h-20 sm:w-20 sm:text-4xl sm:shadow-[5px_5px_0_#000]">
              🔌
            </div>

            {/* Print */}
            <div className="absolute bottom-28 right-1 z-20 hidden rotate-[-5deg] rounded-xl border-2 border-black bg-white px-3 py-2 shadow-[4px_4px_0_#000] sm:block">
              <p className="text-xs font-black">PRINT THIS</p>
              <p className="text-[10px] font-semibold text-black/50">
                Assignment 😭
              </p>
            </div>

            {/* Bottom joke */}
            <div className="absolute bottom-0 left-1/2 z-30 -translate-x-1/2 translate-y-1/2 rotate-[-2deg] whitespace-nowrap rounded-full border-2 border-black bg-white px-5 py-2.5 shadow-[4px_4px_0_#000] sm:px-6 sm:py-3 sm:shadow-[5px_5px_0_#000]">
              <span className="text-base font-black sm:text-lg">
                Say less. 🫡
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* WHY PACKAM */}
      <section className="border-y border-black/5 bg-[#fff4cf]">
        <div className="packam-container py-7">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:items-center">
            <div>
              <p className="text-2xl font-black leading-tight tracking-tight">
                Why leave
                <br />
                your spot? 😭
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-3xl">🎓</span>

              <div>
                <p className="font-black">Lecture?</p>
                <p className="text-sm text-black/50">Stay there.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-3xl">🏠</span>

              <div>
                <p className="font-black">Hostel?</p>
                <p className="text-sm text-black/50">Stay there.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-3xl">😮‍💨</span>

              <div>
                <p className="font-black">Too tired to trek?</p>
                <p className="text-sm text-black/50">
                  Definitely stay there. 😂
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CATEGORIES */}
      <section className="py-12 sm:py-20">
        <div className="packam-container">
          <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-black/60">
                Browse
              </p>

              <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] sm:text-4xl">
                What are you looking for?
              </h2>

              <p className="mt-2 text-sm font-medium text-black/65">
                Pick a category and start looking.
              </p>
            </div>

            <Link
              href="/search"
              className="hidden text-sm font-black underline underline-offset-4 sm:block"
            >
              View all categories →
            </Link>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-3 sm:gap-4">
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
      <section className="bg-[#f7f5ee] py-12 sm:py-20">
        <div className="packam-container">
          <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-black/60">
                Marketplace
              </p>

              <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] sm:text-4xl">
                People dey order these 👀
              </h2>

              <p className="mt-2 text-sm font-medium text-black/65">
                Apparently, everybody needs something.
              </p>
            </div>

            <Link
              href="/search"
              className="hidden text-sm font-black underline underline-offset-4 sm:block"
            >
              See all products →
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
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-black/10 bg-white px-6 py-3 text-sm font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
                >
                  Request a product
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* REQUEST PRODUCT */}
      <section className="py-12 sm:py-20">
        <div className="packam-container">
          <div className="relative overflow-hidden rounded-[1.5rem] bg-black px-5 py-9 text-white sm:rounded-[2rem] sm:px-12 sm:py-16">
            {/* Decorative shapes */}
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

              <p className="mt-5 max-w-xl text-base leading-7 text-white/55">
                Don&apos;t see what you&apos;re looking for? Send us the
                product details and we&apos;ll check if we can source it.
              </p>

              <Link
                href="/product-requests"
                className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-[#feb80a] px-6 py-3 text-sm font-black text-black transition hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:mt-8"
              >
                Request a Product →
              </Link>
            </div>

            <div className="absolute bottom-8 right-8 hidden rotate-[-8deg] rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm lg:block">
              <p className="text-sm font-black">“Abeg find this one.”</p>
              <p className="mt-1 text-xs text-white/50">
                — every student ever 😂
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* STUDENT REALITY */}
      <section className="pb-20">
        <div className="packam-container">
          <div className="rounded-[1.5rem] border border-black/5 bg-[#fff4cf] px-5 py-8 sm:rounded-[2rem] sm:px-12 sm:py-10">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-black/60">
                  Student reality
                </p>

                <h2 className="mt-3 text-2xl font-black leading-tight tracking-[-0.04em] sm:text-4xl">
                  Things students
                  <br />
                  shouldn&apos;t have to do. 😭
                </h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  "Trek under OOU sun for one small thing.",
                  "Leave lecture because you forgot your charger.",
                  "Search 12 WhatsApp groups for one item.",
                  "Leave your room just to print one assignment.",
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl bg-white px-5 py-4 text-sm font-bold shadow-sm"
                  >
                    <span className="mr-2">❌</span>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 border-t border-black/10 pt-7">
              <p className="text-center text-xl font-black sm:text-2xl">
                Just PackAM it. 📦
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}