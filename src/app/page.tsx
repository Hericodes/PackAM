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

type Service = {
  id: string;
  icon: IconName;
  title: string;
  body: string;
  /** Live services link into their existing flow; a service without an href is shown as coming soon. */
  href?: string;
  cta?: string;
  featured?: boolean;
  meta?: string;
};

const SERVICES: Service[] = [
  {
    id: "order",
    icon: "shop",
    title: "Order stuff",
    body: "Food, drinks, academic materials and everyday essentials, delivered to you.",
    href: "/search",
    cta: "Browse and order",
    featured: true,
    meta: `₦${STUDENT_DELIVERY_FEE.toLocaleString()} delivery`,
  },
  {
    id: "verification",
    icon: "shieldCheck",
    title: "Student Verification",
    body: "Your student verification needs, made easier. We’re working on it.",
  },
  {
    id: "printing",
    icon: "printer",
    title: "Printing",
    body: "Print your documents without unnecessary campus stress.",
    href: "/printing",
    cta: "Print documents",
    meta: `From ₦${PRINTING_PRICES.A4.BLACK_AND_WHITE.toLocaleString()}/page`,
  },
];

function ServiceCard({ service }: { service: Service }) {
  const iconTile = (
    <span
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
        service.featured ? "bg-black text-[#feb80a]" : service.href ? "bg-[#fff4c7] text-[#875a00]" : "bg-black/6 text-black/55"
      }`}
    >
      <Icon name={service.icon} className="h-6 w-6" />
    </span>
  );

  if (!service.href) {
    return (
      <div
        aria-labelledby={`service-${service.id}`}
        aria-describedby={`service-${service.id}-status`}
        className="relative flex h-full gap-4 rounded-[22px] border border-dashed border-black/15 bg-[repeating-linear-gradient(135deg,rgba(8,8,8,0.025)_0_10px,transparent_10px_20px)] p-5 md:flex-col"
      >
        {iconTile}
        <div className="flex min-w-0 flex-1 flex-col">
          <span id={`service-${service.id}-status`} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-black px-2.5 py-1 text-[0.6875rem] font-black uppercase tracking-[0.12em] text-[#feb80a]">
            <Icon name="clock" className="h-3.5 w-3.5" strokeWidth={2.2} /> Coming soon
          </span>
          <h3 id={`service-${service.id}`} className="mt-2.5 text-lg font-black tracking-[-0.01em] text-black/80">{service.title}</h3>
          <p className="mt-1 text-sm leading-6 text-black/60">{service.body}</p>
          <p className="mt-auto pt-3 text-sm font-bold text-black/45">Not available yet</p>
        </div>
      </div>
    );
  }

  return (
    <Link
      href={service.href}
      aria-labelledby={`service-${service.id}`}
      className={`group flex h-full gap-4 rounded-[22px] p-5 transition-[box-shadow,transform,border-color] duration-150 hover:-translate-y-0.5 md:flex-col ${
        service.featured
          ? "bg-[#feb80a] shadow-[0_18px_40px_-26px_rgba(135,90,0,0.8)] hover:shadow-[0_22px_44px_-24px_rgba(135,90,0,0.9)]"
          : "border border-black/8 bg-white shadow-[0_1px_2px_rgba(8,8,8,0.04)] hover:border-black/20 hover:shadow-(--shadow-soft)"
      }`}
    >
      {iconTile}
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 id={`service-${service.id}`} className="text-lg font-black tracking-[-0.01em]">{service.title}</h3>
        <span className={`mt-1 text-sm leading-6 ${service.featured ? "text-black/75" : "text-black/65"}`}>{service.body}</span>
        <span className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-black">
            {service.cta} <Icon name="arrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
          {service.meta && <span className={`text-xs font-semibold ${service.featured ? "text-black/65" : "text-black/55"}`}>{service.meta}</span>}
        </span>
      </div>
    </Link>
  );
}

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
              Your campus needs, all in one place.
            </p>
          </div>

          <section className="mt-7 sm:mt-9" aria-labelledby="services-title">
            <h2 id="services-title" className="sr-only">What do you need today?</h2>
            <ul className="grid gap-3 md:grid-cols-3 md:gap-4">
              {SERVICES.map((service) => (
                <li key={service.id}>
                  <ServiceCard service={service} />
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-8 max-w-2xl">
            <p className="text-sm font-bold text-black/70">Already know what you want?</p>
            <form action="/search" role="search" className="mt-2 flex max-w-xl gap-2">
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

      <section className="packam-container pt-10 sm:pt-14" aria-labelledby="popular">
        <div className="flex items-end justify-between gap-4">
          <h2 id="popular" className="pk-section-title">New on PackAM</h2>
          {products.length > 0 && <Link href="/search" className="text-sm font-bold underline underline-offset-4">Browse all</Link>}
        </div>
        {products.length ? (
          <div className="pk-product-grid mt-4">
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
