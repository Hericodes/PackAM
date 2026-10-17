import Link from "next/link";
import { auth } from "../auth";
import { StudentNavbar } from "../components/student/StudentNavbar";
import { ProductCard } from "../components/student/ProductCard";
import { EmptyState } from "../components/ui/EmptyState";
import { db } from "../lib/db";
import { Icon, type IconName } from "../components/ui/Icon";
import { STUDENT_DELIVERY_FEE, studentCatalogueProductWhere } from "../lib/products/catalogue";
import { formatCampusTime, orderStatusLabel } from "../lib/student-copy";
import { PRINTING_PRICES } from "../lib/printing/pricing";

const STEPS = [
  { icon: "🔎", title: "Find it", body: "Search the catalogue, or request anything that isn’t listed." },
  { icon: "💳", title: "Pay securely", body: `Your total and the ₦${STUDENT_DELIVERY_FEE.toLocaleString()} delivery fee are shown before you pay with OPay.` },
  { icon: "🛵", title: "We bring it", body: "A campus runner picks it up and you track every step." },
];

const PRINT_STEPS: { icon: IconName; label: string }[] = [
  { icon: "file", label: "Upload a PDF" },
  { icon: "receipt", label: "See the exact price" },
  { icon: "truck", label: "Delivered to you" },
];

export default async function HomePage() {
  const session = await auth();
  const studentId = session?.user.role === "STUDENT" ? session.user.id : null;

  const [products, recentOrders] = await Promise.all([
    db.product.findMany({
      where: studentCatalogueProductWhere,
      select: { id: true, name: true, customerPrice: true, imageUrl: true, category: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
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
    <main className="min-h-screen text-black">
      <StudentNavbar />

      <section className="pk-hero">
        <div className="packam-container py-10 sm:py-14 lg:py-16">
          <div className="max-w-2xl">
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
              <input id="home-search" name="q" type="search" placeholder="What do you need? Try “indomie” or “charger”" className="pk-input min-h-[52px] flex-1 shadow-sm focus:shadow-[0_0_0_3px_rgba(254,184,10,0.45)]" />
              <button type="submit" className="pk-btn pk-btn-primary pk-btn-lg">Search</button>
            </form>
            <Link href="/search" className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-black/70 underline-offset-4 hover:text-black hover:underline">
              Browse the full catalogue <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
          </div>
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

      <section className="packam-container pt-10 sm:pt-14" aria-labelledby="printing-card-title">
        <div className="relative overflow-hidden rounded-[28px] border border-[#feb80a]/40 bg-gradient-to-br from-[#ffe8a1] via-[#fff5d1] to-white shadow-[0_18px_40px_-28px_rgba(135,90,0,0.55)]">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#feb80a]/25 blur-3xl" aria-hidden="true" />
          <div className="relative grid gap-8 p-6 sm:p-8 md:grid-cols-[1.25fr_0.75fr] md:items-center lg:p-10">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-black px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-[#feb80a]">
                <Icon name="printer" className="h-4 w-4" /> PackAM Printing
              </p>
              <h2 id="printing-card-title" className="mt-4 text-[clamp(1.75rem,4.5vw,2.5rem)] font-black leading-[1.05] tracking-[-0.03em]">Print without the queue.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-black/75 sm:text-base">
                Upload a PDF, choose colour, copies and pages, and see the exact price before you pay. A runner brings the prints to you.
              </p>
              <ul className="mt-5 grid gap-2 text-sm font-semibold sm:grid-cols-3">
                {PRINT_STEPS.map((step) => (
                  <li key={step.label} className="flex items-center gap-2.5 rounded-2xl bg-white/80 px-3 py-2.5 ring-1 ring-black/5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#feb80a]/25 text-[#875a00]"><Icon name={step.icon} className="h-4 w-4" /></span>
                    {step.label}
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link href="/printing" className="pk-btn pk-btn-primary pk-btn-lg">
                  Start a print job <Icon name="arrowRight" className="h-4 w-4" />
                </Link>
                <p className="text-sm text-black/70">
                  <strong className="text-black">₦{PRINTING_PRICES.A4.BLACK_AND_WHITE.toLocaleString()}</strong>/page B&amp;W · <strong className="text-black">₦{PRINTING_PRICES.A4.COLOR.toLocaleString()}</strong>/page colour
                </p>
              </div>
            </div>

            <div className="relative mx-auto hidden h-48 w-48 md:block lg:h-56 lg:w-56" aria-hidden="true">
              <div className="absolute inset-x-6 top-2 h-36 -rotate-8 rounded-2xl border border-black/10 bg-white/70 lg:h-44" />
              <div className="absolute inset-x-4 top-4 h-36 rotate-5 rounded-2xl border border-black/10 bg-white shadow-[0_10px_30px_-12px_rgba(8,8,8,0.25)] lg:h-44">
                <div className="space-y-2 p-5">
                  <span className="block h-2 w-3/4 rounded-full bg-black/15" />
                  <span className="block h-2 w-full rounded-full bg-black/10" />
                  <span className="block h-2 w-5/6 rounded-full bg-black/10" />
                  <span className="block h-2 w-2/3 rounded-full bg-black/10" />
                  <span className="mt-4 block h-10 w-full rounded-lg bg-[#fff4c7]" />
                </div>
              </div>
              <span className="absolute -bottom-1 right-0 flex h-16 w-16 items-center justify-center rounded-2xl bg-black text-[#feb80a] shadow-lg lg:h-20 lg:w-20">
                <Icon name="printer" className="h-8 w-8 lg:h-10 lg:w-10" strokeWidth={1.7} />
              </span>
            </div>
          </div>
        </div>
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
