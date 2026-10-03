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
        <div className="packam-container grid min-h-[620px] items-center gap-12 py-12 lg:grid-cols-[0.95fr_1.05fr] lg:py-16">
          {/* LEFT */}
          <div className="relative z-10">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-black shadow-sm">
              <span>👀</span>
              OOU students, we got you.
            </div>

            <h1 className="max-w-3xl text-[3.7rem] font-black leading-[0.9] tracking-[-0.055em] sm:text-6xl lg:text-[5.5rem]">
              Need something?
              <br />
              <span className="text-[#feb80a]">WE PackAM.</span>
            </h1>

            <p className="mt-7 max-w-xl text-lg font-medium leading-8 text-black/60 sm:text-xl">
              Food? Notes? Charger? Something random?
              <br />
              <span className="font-black text-black">
                Just find am. 😂
              </span>
            </p>

            {/* SEARCH */}
            <Link
              href="/search"
              className="group mt-8 flex max-w-2xl items-center gap-4 rounded-[1.25rem] border border-black/10 bg-white p-2 pl-5 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:border-black/20 hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)]"
            >
              <span className="text-2xl text-black/45">⌕</span>

              <span className="flex-1 text-left text-base font-semibold text-black/40 sm:text-lg">
                What do you need? 👀
              </span>

              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#feb80a] text-xl font-black transition group-hover:scale-105">
                →
              </span>
            </Link>

            <p className="mt-3 pl-1 text-xs font-semibold text-black/40 sm:text-sm">
              Try “jollof”, “BIO 101 note”, “charger”, “print”...
            </p>
          </div>

          {/* RIGHT — PACKAM VISUAL */}
          <div className="relative min-h-[430px] lg:min-h-[500px]">
            {/* Main background shape */}
            <div className="absolute inset-4 rotate-[-2deg] rounded-[3rem] bg-[#feb80a] sm:inset-0" />

            {/* Decorative circles */}
            <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-[#ffd968]" />
            <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-[#ffe89c]" />

            {/* Floating note 1 */}
            <div className="absolute left-2 top-8 z-20 rotate-[-7deg] rounded-2xl border-2 border-black bg-white px-4 py-3 shadow-[5px_5px_0_#000] sm:left-0">
              <p className="text-sm font-black">I need this.</p>
              <p className="text-lg">👀</p>
            </div>

            {/* Floating note 2 */}
            <div className="absolute right-0 top-20 z-20 rotate-[5deg] rounded-2xl border-2 border-black bg-white px-4 py-3 shadow-[5px_5px_0_#000]">
              <p className="text-sm font-black">Abeg help me</p>
              <p className="text-sm font-black">find this. 😭</p>
            </div>

            {/* Main package */}
            <div className="absolute left-1/2 top-1/2 z-10 flex h-[270px] w-[230px] -translate-x-1/2 -translate-y-1/2 rotate-[-3deg] items-center justify-center rounded-[2rem] border-[5px] border-black bg-[#f5a900] shadow-[12px_14px_0_#000] sm:h-[310px] sm:w-[260px]">
              <div className="text-center">
                <div className="text-7xl">📦</div>

                <p className="mt-4 text-4xl font-black tracking-[-0.05em]">
                  PackAM
                </p>

                <p className="mt-2 text-xs font-black uppercase tracking-[0.2em]">
                  We go find am.
                </p>
              </div>
            </div>

            {/* Food */}
            <div className="absolute bottom-12 left-4 z-20 flex h-24 w-24 rotate-[-8deg] items-center justify-center rounded-3xl border-2 border-black bg-white text-5xl shadow-[5px_5px_0_#000] sm:left-10">
              🍛
            </div>

            {/* Book */}
            <div className="absolute right-5 top-4 z-20 flex h-24 w-24 rotate-[8deg] items-center justify-center rounded-3xl border-2 border-black bg-white text-5xl shadow-[5px_5px_0_#000] sm:right-12">
              📚
            </div>

            {/* Charger */}
            <div className="absolute bottom-6 right-4 z-20 flex h-20 w-20 rotate-[8deg] items-center justify-center rounded-3xl border-2 border-black bg-white text-4xl shadow-[5px_5px_0_#000] sm:right-16">
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
            <div className="absolute bottom-0 left-1/2 z-30 -translate-x-1/2 translate-y-1/2 rotate-[-2deg] whitespace-nowrap rounded-full border-2 border-black bg-white px-6 py-3 shadow-[5px_5px_0_#000]">
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
      <section className="py-16 sm:py-20">
        <div className="packam-container">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-black/35">
                Browse
              </p>

              <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] sm:text-4xl">
                What are you looking for?
              </h2>

              <p className="mt-2 text-sm font-medium text-black/45">
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

          <div className="flex gap-4 overflow-x-auto pb-3">
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
      <section className="bg-[#f7f5ee] py-16 sm:py-20">
        <div className="packam-container">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-black/35">
                Marketplace
              </p>

              <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] sm:text-4xl">
                People dey order these 👀
              </h2>

              <p className="mt-2 text-sm font-medium text-black/45">
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
            <div className="rounded-[2rem] border border-black/5 bg-white px-6 py-16 text-center">
              <div className="text-5xl">📦</div>

              <h3 className="mt-5 text-xl font-black">
                Nothing here yet. 👀
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-black/50">
                We&apos;re still stocking the marketplace. Check back soon or
                tell us what you&apos;re looking for.
              </p>

              <Link
                href="/search"
                className="mt-6 inline-flex rounded-full bg-black px-6 py-3 text-sm font-black text-white transition hover:bg-black/85"
              >
                Find something →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* REQUEST PRODUCT */}
      <section className="py-16 sm:py-20">
        <div className="packam-container">
          <div className="relative overflow-hidden rounded-[2rem] bg-black px-7 py-12 text-white sm:px-12 sm:py-16">
            {/* Decorative shapes */}
            <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#feb80a]" />
            <div className="absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-white/5" />

            <div className="relative z-10 max-w-2xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#feb80a]">
                Can&apos;t find it?
              </p>

              <h2 className="mt-3 text-4xl font-black leading-tight tracking-[-0.04em] sm:text-5xl">
                No wahala.
                <br />
                Tell us what you need. 🫡
              </h2>

              <p className="mt-5 max-w-xl text-base leading-7 text-white/55">
                Don&apos;t see what you&apos;re looking for? Send us the
                product details and we&apos;ll check if we can source it.
              </p>

              <Link
                href="/search"
                className="mt-8 inline-flex rounded-full bg-[#feb80a] px-6 py-3.5 text-sm font-black text-black transition hover:scale-[1.02]"
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
          <div className="rounded-[2rem] border border-black/5 bg-[#fff4cf] px-7 py-10 sm:px-12">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-black/35">
                  Student reality
                </p>

                <h2 className="mt-3 text-3xl font-black leading-tight tracking-[-0.04em] sm:text-4xl">
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