import Link from "next/link";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";

const labels: Record<string, string> = { PAYMENT_CONFIRMED: "Payment confirmed", FINDING_RUNNER: "Finding a runner", RUNNER_ASSIGNED: "Runner assigned", SOURCING_PRODUCT: "Getting your items", OUT_FOR_DELIVERY: "On the way", DELIVERED: "Delivered", REFUND_PROCESSING: "Refund processing", REFUNDED: "Refunded", FAILED: "Payment failed", CANCELLED: "Cancelled" };
export default async function OrdersPage() {
  const session = await requireRole("STUDENT", "/orders");
  const orders = await db.order.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, total: true, createdAt: true, items: { select: { productName: true, quantity: true } } } });
  return (
    <main className="min-h-screen bg-[#fffdf7]">
      <div className="packam-container py-7 sm:py-10">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-black/45">Order history</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Your orders</h1>
        <p className="mt-2 text-sm leading-6 text-black/55">Follow each order from payment to delivery.</p>
        {orders.length ? (
          <div className="mt-6 grid gap-3 sm:mt-8">
            {orders.map((order) => (
              <Link key={order.id} href={`/orders/${order.id}`} className="group block rounded-2xl border border-black/5 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-black/15 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="inline-flex rounded-full bg-[#fff4c7] px-3 py-1 text-sm font-black text-black/80">{labels[order.status] ?? order.status.replaceAll("_", " ")}</span>
                    <p className="mt-3 break-words text-sm font-bold leading-5">{order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ")}</p>
                    <p className="mt-2 text-xs text-black/50">{order.createdAt.toLocaleString()}</p>
                  </div>
                  <strong className="shrink-0 whitespace-nowrap text-base font-black">₦{order.total.toLocaleString()}</strong>
                </div>
                <span className="mt-4 inline-flex min-h-10 items-center gap-1 text-sm font-black text-black/65 transition group-hover:text-black">View order <span aria-hidden="true">→</span></span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:mt-8 sm:p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fff4c7] text-2xl" aria-hidden="true">🛍️</div>
            <h2 className="mt-4 text-lg font-black">No orders yet</h2>
            <p className="mt-1 text-sm leading-6 text-black/60">Your completed checkouts will show up here.</p>
            <Link className="mt-4 inline-flex min-h-11 items-center font-black underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black" href="/search">Browse the marketplace</Link>
          </div>
        )}
      </div>
    </main>
  );
}
