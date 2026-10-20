import Link from "next/link";
import { requireRole } from "../../../lib/auth-guard";
import { OrderStatus } from "@prisma/client";
import { db } from "../../../lib/db";
import { ORDER_STATUS_GROUPS, adminListHref, orderListWhere } from "../../../lib/admin-list-filters";
import { orderStatusDisplay, paymentStatusDisplay } from "../../../lib/ops-status";
import { formatCampusTime, shortReference } from "../../../lib/student-copy";
import { StatusBadge } from "../../../components/ui/StatusBadge";

const take = 50;
// Order statuses an order can actually be listed in (orders are created after payment).
const FILTERS = [OrderStatus.FINDING_RUNNER, OrderStatus.RUNNER_ASSIGNED, OrderStatus.SOURCING_PRODUCT, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, OrderStatus.REFUND_PROCESSING, OrderStatus.REFUNDED, OrderStatus.CANCELLED, OrderStatus.FAILED];

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const { where, status, q } = orderListWhere(params.status, params.q);
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const [orders, total] = await Promise.all([
    db.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take, select: { id: true, status: true, total: true, createdAt: true, deliveryLocation: { select: { label: true } }, user: { select: { firstName: true, lastName: true, email: true } }, payment: { select: { status: true } }, assignedRunner: { select: { user: { select: { firstName: true } } } }, _count: { select: { items: true } } } }),
    db.order.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / take));
  const chip = (value: string, label: string) => <Link key={value || "all"} href={adminListHref("/admin/orders", { status: value, q })} aria-current={status === value ? "page" : undefined} className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-4 text-sm font-bold ${status === value ? "bg-black text-white" : "bg-white hover:ring-1 hover:ring-black/15"}`}>{label}</Link>;

  return <main className="min-h-screen"><div className="packam-container py-8">
    <p className="text-xs font-black uppercase tracking-widest text-black/40">Daily ops</p>
    <h1 className="mt-1 text-3xl font-black">Orders</h1>

    <form action="/admin/orders" role="search" className="mt-4 flex max-w-xl gap-2">
      {status && <input type="hidden" name="status" value={status} />}
      <label htmlFor="order-search" className="sr-only">Search orders</label>
      <input id="order-search" name="q" type="search" defaultValue={q} placeholder="Student name, email or order reference" className="pk-input min-h-11 flex-1" />
      <button type="submit" className="pk-btn pk-btn-primary">Search</button>
    </form>

    <nav aria-label="Filter by status" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {chip("", "All")}
      {chip("ACTIVE", ORDER_STATUS_GROUPS.ACTIVE.label)}
      {FILTERS.map((value) => chip(value, orderStatusDisplay(value).label))}
    </nav>

    <section aria-label="Orders" className="mt-5 overflow-hidden rounded-2xl bg-white">
      <div className="hidden grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-3 border-b border-black/5 bg-[#f7f5ee] px-4 py-2.5 text-xs font-black uppercase tracking-wide text-black/45 md:grid"><span>Student</span><span>Order status</span><span>Payment</span><span>Placed</span><span className="text-right">Total</span></div>
      <ul className="divide-y divide-black/5">{orders.map((order) => {
        const orderDisplay = orderStatusDisplay(order.status);
        const paymentDisplay = paymentStatusDisplay(order.payment?.status);
        return <li key={order.id}><Link href={`/admin/orders/${order.id}`} className="grid gap-2 p-4 hover:bg-black/2 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto] md:items-center md:gap-3">
          <div className="min-w-0"><p className="truncate font-black">{order.user.firstName} {order.user.lastName}</p><p className="truncate text-xs text-black/45">#{shortReference(order.id)} · {order._count.items} {order._count.items === 1 ? "item" : "items"} · {order.deliveryLocation?.label ?? "Campus delivery"}{order.assignedRunner ? ` · Runner: ${order.assignedRunner.user.firstName ?? "—"}` : ""}</p></div>
          <div className="flex flex-wrap gap-2 md:block"><StatusBadge label={orderDisplay.label} tone={orderDisplay.tone} /><span className="md:hidden"><StatusBadge label={paymentDisplay.label} tone={paymentDisplay.tone} /></span></div>
          <div className="hidden md:block"><StatusBadge label={paymentDisplay.label} tone={paymentDisplay.tone} /></div>
          <p className="text-xs text-black/55 md:text-sm">{formatCampusTime(order.createdAt)}</p>
          <p className="text-sm font-black md:text-right">₦{order.total.toLocaleString()}</p>
        </Link></li>;
      })}</ul>
      {!orders.length && <div className="p-8 text-center"><p className="font-black">{q || status ? "No orders match this view" : "No orders yet"}</p><p className="mt-1 text-sm text-black/50">{q || status ? "Try another search or status." : "When students order, they’ll land here."}</p>{(q || status) && <Link href="/admin/orders" className="mt-3 inline-flex min-h-10 items-center text-sm font-bold underline">Clear filters</Link>}</div>}
    </section>

    <nav aria-label="Order pages" className="mt-3 flex flex-wrap items-center gap-4 text-sm">
      <span className="text-black/50">{total} {total === 1 ? "order" : "orders"} · Page {page} of {pages}</span>
      {page > 1 && <Link className="inline-flex min-h-10 items-center font-bold underline" href={adminListHref("/admin/orders", { status, q, page: page - 1 })}>← Newer</Link>}
      {page < pages && <Link className="inline-flex min-h-10 items-center font-bold underline" href={adminListHref("/admin/orders", { status, q, page: page + 1 })}>Older →</Link>}
    </nav>
  </div></main>;
}
