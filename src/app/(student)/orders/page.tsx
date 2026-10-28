import Link from "next/link";
import { ReorderButton } from "../../../components/orders/ReorderButton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";
import { UNPAID_PRINT_JOB_WHERE } from "../../../lib/printing/service";
import { formatCampusTime, isFinalOrderStatus, orderProgress, orderStatusLabel, shortReference } from "../../../lib/student-copy";

type OrderRow = {
  id: string;
  status: string;
  total: number;
  createdAt: Date;
  items: { productId: string; productName: string; quantity: number }[];
};

function OrderCard({ order, showReorder }: { order: OrderRow; showReorder: boolean }) {
  const summary = order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ");
  const progress = isFinalOrderStatus(order.status) ? null : orderProgress(order.status);
  return (
    <li className="pk-card pk-card-interactive p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`pk-pill ${order.status === "DELIVERED" ? "pk-pill-success" : isFinalOrderStatus(order.status) ? "pk-pill-neutral" : ""}`}>{orderStatusLabel(order.status)}</span>
            <span className="pk-muted text-xs">Order {shortReference(order.id)}</span>
          </div>
          <p className="mt-3 line-clamp-2 text-sm font-bold leading-5">{summary}</p>
          <p className="pk-muted mt-1 text-xs">{formatCampusTime(order.createdAt)}</p>
        </div>
        <strong className="shrink-0 whitespace-nowrap text-base font-black">₦{order.total.toLocaleString()}</strong>
      </div>
      {progress && (
        <div className="mt-4 flex gap-1" aria-hidden="true">
          {progress.map((step) => <span key={step.label} className={`h-1.5 flex-1 rounded-full ${step.state === "upcoming" ? "bg-black/10" : step.state === "current" ? "bg-[#feb80a]" : "bg-black"}`} />)}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-start gap-2">
        <Link href={`/orders/${order.id}`} className="pk-btn pk-btn-primary pk-btn-sm">{isFinalOrderStatus(order.status) ? "View details" : "Track order"}</Link>
        {showReorder && <ReorderButton size="small" items={order.items.map((item) => ({ productId: item.productId, name: item.productName, quantity: item.quantity }))} />}
      </div>
    </li>
  );
}

export default async function OrdersPage() {
  const session = await requireRole("STUDENT", "/orders");
  const [orders, printJobCount] = await Promise.all([
    db.order.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, status: true, total: true, createdAt: true, shopId: true, items: { select: { productId: true, productName: true, quantity: true } } },
    }),
    db.printJob.count({ where: { userId: session.user.id, NOT: UNPAID_PRINT_JOB_WHERE } }),
  ]);
  const active = orders.filter((order) => !isFinalOrderStatus(order.status));
  const past = orders.filter((order) => isFinalOrderStatus(order.status));

  return (
    <main className="min-h-screen pb-16">
      <div className="packam-container py-7 sm:py-10">
        <p className="pk-eyebrow">Your orders</p>
        <h1 className="pk-page-title mt-2">Orders</h1>
        <p className="pk-muted mt-2 text-sm leading-6 sm:text-base">Follow every order from payment to your door — or order your favourites again.</p>
        {printJobCount > 0 && (
          <Link href="/printing" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-bold underline underline-offset-4">
            <span aria-hidden="true">🖨️</span> Looking for a print job? See your print jobs →
          </Link>
        )}

        {orders.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon="🛍️" title="No orders yet" body="Why trek in this sun? ☀️ Order something and you’ll track it here." actions={[{ href: "/search", label: "Start shopping" }, { href: "/printing", label: "Print a document", variant: "secondary" }]} />
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <section className="mt-7" aria-labelledby="active-orders">
                <h2 id="active-orders" className="pk-section-title">In progress</h2>
                <ul className="mt-3 grid gap-3">{active.map((order) => <OrderCard key={order.id} order={order} showReorder={false} />)}</ul>
              </section>
            )}
            {past.length > 0 && (
              <section className="mt-8" aria-labelledby="past-orders">
                <h2 id="past-orders" className="pk-section-title">Past orders</h2>
                <ul className="mt-3 grid gap-3">{past.map((order) => <OrderCard key={order.id} order={order} showReorder={order.status === "DELIVERED" && !order.shopId} />)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
