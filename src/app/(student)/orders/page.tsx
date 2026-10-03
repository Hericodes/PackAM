import Link from "next/link";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";

const labels: Record<string, string> = { PAYMENT_CONFIRMED: "Payment confirmed", FINDING_RUNNER: "Finding a runner", RUNNER_ASSIGNED: "Runner assigned", SOURCING_PRODUCT: "Getting your items", OUT_FOR_DELIVERY: "On the way", DELIVERED: "Delivered", REFUND_PROCESSING: "Refund processing", REFUNDED: "Refunded", FAILED: "Payment failed", CANCELLED: "Cancelled" };
export default async function OrdersPage() {
  const session = await requireRole("STUDENT", "/orders");
  const orders = await db.order.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, total: true, createdAt: true, items: { select: { productName: true, quantity: true } } } });
  return <main className="min-h-screen bg-[#fffdf7]"><div className="packam-container py-10"><h1 className="text-3xl font-black">Your orders</h1><p className="mt-2 text-sm text-black/55">Follow each order from payment to delivery.</p>{orders.length ? <div className="mt-7 grid gap-3">{orders.map((order) => <Link key={order.id} href={`/orders/${order.id}`} className="rounded-2xl border border-black/5 bg-white p-5 hover:border-black/15"><div className="flex justify-between gap-4"><div><p className="font-black">{labels[order.status] ?? order.status.replaceAll("_", " ")}</p><p className="mt-1 text-sm text-black/55">{order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ")}</p></div><strong className="shrink-0">₦{order.total.toLocaleString()}</strong></div><p className="mt-3 text-xs text-black/40">{order.createdAt.toLocaleString()} · View order →</p></Link>)}</div> : <div className="mt-7 rounded-2xl bg-white p-6 text-sm text-black/60">No orders yet. <Link className="font-bold underline" href="/search">Browse the marketplace</Link></div>}</div></main>;
}
