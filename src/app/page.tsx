import Link from "next/link";
import { auth } from "../auth";
import { StudentNavbar } from "../components/student/StudentNavbar";
import { ProductCard } from "../components/student/ProductCard";
import { EmptyState } from "../components/ui/EmptyState";
import { db } from "../lib/db";
import { categoryDisplay } from "../lib/products/category-display";
import { STUDENT_DELIVERY_FEE, studentCatalogueCategoryWhere, studentCatalogueProductWhere } from "../lib/products/catalogue";
import { formatCampusTime, orderStatusLabel } from "../lib/student-copy";
import { PRINTING_PRICES } from "../lib/printing/pricing";

const STEPS = [
  { icon: "🔎", title: "Find it", body: "Search the catalogue, or request anything that isn’t listed." },
  { icon: "💳", title: "Pay securely", body: `Your total and the ₦${STUDENT_DELIVERY_FEE.toLocaleString()} delivery fee are shown before you pay with OPay.` },
  { icon: "🛵", title: "We bring it", body: "A campus runner picks it up and you track every step." },
];

export default async function HomePage() {
  const session = await auth();
  const studentId = session?.user.role === "STUDENT" ? session.user.id : null;

  const [products, categories, recentOrders] = await Promise.all([
    db.product.findMany({
      where: studentCatalogueProductWhere,
      select: { id: true, name: true, customerPrice: true, imageUrl: true, category: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    db.category.findMany({
      where: studentCatalogueCategoryWhere,
      select: { name: true, slug: true, _count: { select: { products: { where: { status: "ACTIVE" } } } } },
      orderBy: { name: "asc" },
    }),
    studentId
      ? db.order.findMany({
          where: { userId: studentId },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { id: true, status: true, total: true, createdAt: true, items: { select: { productName: true, quantity: true }, take: 3 } },
        })
      : Promise.resolve([]),
  ]);

  return (
    <main className="min-h-screen bg-[#fffdf7] text-black">
      <StudentNavbar />

      <section className="pk-hero">
        <div className="packam-container grid gap-8 py-10 sm:py-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-16">
          <div>
            <p className="pk-eyebrow">For OOU students</p>
            <h1 className="mt-3 text-[clamp(2.25rem,7vw,3.75rem)] font-black leading-[1.02] tracking-[-0.035em]">
              Need something?
              <br />
              <span className="text-[#875a00]">WE PackAM.</span>
            </h1>
            <p className="pk-muted mt-4 max-w-lg text-base leading-7 sm:text-lg">
              Food, study supplies, chargers and printing — ordered from wherever you are on campus and brought to you.
            </p>
            <form action="/search" role="search" className="mt-6 flex max-w-xl gap-2">
              <label htmlFor="home-search" className="sr-only">Search PackAM</label>
              <input id="home-search" name="q" type="search" placeholder="What do you need? Try “indomie” or “charger”" className="pk-input min-h-[52px] flex-1 shadow-sm" />
              <button type="submit" className="pk-btn pk-btn-primary pk-btn-lg">Search</button>
            </form>
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-black/70" aria-label="Why PackAM">
              <li>✓ ₦{STUDENT_DELIVERY_FEE.toLocaleString()} flat delivery</li>
              <li>✓ Secure OPay checkout</li>
              <li>✓ Track every step</li>
            </ul>
          </div>

          <nav aria-label="Shop by category" className="grid grid-cols-2 gap-3">
            {categories.slice(0, 3).map((category) => {
              const display = categoryDisplay(category.slug);
              return (
                <Link key={category.slug} href={`/search?category=${category.slug}`} className="pk-card pk-card-interactive flex min-h-[112px] flex-col justify-between p-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl" style={{ backgroundColor: display.tint }} aria-hidden="true">{display.icon}</span>
                  <span className="mt-3 text-sm font-extrabold leading-5">{category.name}</span>
                </Link>
              );
            })}
            <Link href="/printing" className="flex min-h-[112px] flex-col justify-between rounded-[20px] bg-black p-4 text-white transition hover:bg-[#1f1f1f]">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#feb80a] text-2xl" aria-hidden="true">🖨️</span>
              <span className="mt-3 text-sm font-extrabold leading-5">Printing <span aria-hidden="true">→</span></span>
            </Link>
          </nav>
        </div>
      </section>

      {recentOrders.length > 0 && (
        <section className="packam-container pt-10 sm:pt-12" aria-labelledby="recent-orders">
          <div className="flex items-end justify-between gap-4">
            <h2 id="recent-orders" className="pk-section-title">Your recent orders</h2>
            <Link href="/orders" className="text-sm font-bold underline underline-offset-4">All orders</Link>
          </div>
          <ul className="mt-4 grid gap-3 md:grid-cols-3">
            {recentOrders.map((order) => (
              <li key={order.id}>
                <Link href={`/orders/${order.id}`} className="pk-card pk-card-interactive block h-full p-4">
                  <span className="pk-pill">{orderStatusLabel(order.status)}</span>
                  <p className="mt-3 line-clamp-2 text-sm font-bold">{order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ")}</p>
                  <p className="pk-muted mt-2 flex justify-between text-xs"><span>{formatCampusTime(order.createdAt)}</span><span className="font-bold text-black">₦{order.total.toLocaleString()}</span></p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="packam-container pt-10 sm:pt-14" aria-labelledby="categories">
        <h2 id="categories" className="pk-section-title">Shop by category</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {categories.map((category) => {
            const display = categoryDisplay(category.slug);
            const count = category._count.products;
            return (
              <li key={category.slug}>
                <Link href={`/search?category=${category.slug}`} className="pk-card pk-card-interactive flex h-full items-start gap-3 p-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl" style={{ backgroundColor: display.tint }} aria-hidden="true">{display.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold leading-5">{category.name}</span>
                    <span className="pk-muted mt-0.5 block text-xs">{count ? `${count} item${count === 1 ? "" : "s"}` : "Coming soon — request it"}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="packam-container pt-10 sm:pt-14" aria-labelledby="popular">
        <div className="flex items-end justify-between gap-4">
          <h2 id="popular" className="pk-section-title">New on PackAM</h2>
          {products.length > 0 && <Link href="/search" className="text-sm font-bold underline underline-offset-4">Browse all</Link>}
        </div>
        {products.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} id={product.id} name={product.name} price={product.customerPrice} image={product.imageUrl} category={product.category.name} />
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState icon="🛍️" title="The shelves are being stocked" body="Products are on the way. Tell us what you need and we’ll find it for you." actions={[{ href: "/product-requests", label: "Request an item" }]} />
          </div>
        )}
      </section>

      <section className="packam-container pt-10 sm:pt-14">
        <div className="pk-feature grid gap-5 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="pk-eyebrow">PackAM Printing</p>
            <h2 className="pk-section-title mt-2">Print without the queue</h2>
            <p className="pk-muted mt-2 max-w-xl text-sm leading-6 sm:text-base">Upload a PDF, choose colour, copies and pages, see the exact price, and get it delivered. ₦{PRINTING_PRICES.A4.BLACK_AND_WHITE.toLocaleString()} per page black &amp; white, ₦{PRINTING_PRICES.A4.COLOR.toLocaleString()} colour.</p>
          </div>
          <Link href="/printing" className="pk-btn pk-btn-primary pk-btn-lg">Start a print job</Link>
        </div>
      </section>

      <section className="packam-container pt-10 sm:pt-14" aria-labelledby="how">
        <h2 id="how" className="pk-section-title">How it works</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="pk-card p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff4c7] text-xl" aria-hidden="true">{step.icon}</span>
              <h3 className="mt-3 font-extrabold"><span className="sr-only">Step {index + 1}: </span>{step.title}</h3>
              <p className="pk-muted mt-1 text-sm leading-6">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="packam-container py-10 sm:py-14">
        <div className="pk-card flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h2 className="pk-section-title">Can’t find it?</h2>
            <p className="pk-muted mt-1 text-sm leading-6 sm:text-base">Tell us what you need. We’ll check campus shops and let you know.</p>
          </div>
          <Link href="/product-requests" className="pk-btn pk-btn-secondary pk-btn-lg">Request an item</Link>
        </div>
      </section>

      <footer className="border-t border-black/5">
        <div className="packam-container flex flex-col gap-3 py-8 text-sm text-black/65 sm:flex-row sm:items-center sm:justify-between">
          <p><strong className="text-black">PackAM</strong> · Need something? WE PackAM.</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-4">
            <Link href="/search" className="hover:text-black">Shop</Link>
            <Link href="/printing" className="hover:text-black">Printing</Link>
            <Link href="/product-requests" className="hover:text-black">Requests</Link>
            <Link href="/support" className="hover:text-black">Help</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
