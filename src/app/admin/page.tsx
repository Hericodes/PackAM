import Link from "next/link";
import { OrderStatus, PaymentStatus, ProductRequestStatus, RefundStatus } from "@prisma/client";
import { db } from "../../lib/db";
import { getRunnerAcceptanceTimeoutMinutes } from "../../lib/orders/price-policy";

const statusNames: Record<string, string> = { PAYMENT_CONFIRMED: "Payment confirmed", FINDING_RUNNER: "Finding runner", RUNNER_ASSIGNED: "Runner assigned", SOURCING_PRODUCT: "Sourcing", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Completed", REFUND_PROCESSING: "Refund processing", REFUNDED: "Refunded", FAILED: "Failed", CANCELLED: "Cancelled" };
export default async function AdminHomePage() {
  const now = new Date(); const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now); const today = new Date(`${localDay}T00:00:00.000+01:00`); const runnerCutoff = new Date(now.getTime() - getRunnerAcceptanceTimeoutMinutes() * 60_000);
  const [todayOrders, findingRunner, assigned, sourcing, outForDelivery, completed, failed, refunds, requests, staleRequests, paymentIssues, openIncidents, waitingPrices, abandoned] = await Promise.all([
    db.order.count({ where: { createdAt: { gte: today } } }),
    db.order.count({ where: { status: OrderStatus.FINDING_RUNNER } }),
    db.order.count({ where: { status: OrderStatus.RUNNER_ASSIGNED } }),
    db.order.count({ where: { status: OrderStatus.SOURCING_PRODUCT } }),
    db.order.count({ where: { status: OrderStatus.OUT_FOR_DELIVERY } }),
    db.order.count({ where: { status: OrderStatus.DELIVERED, deliveredAt: { gte: today } } }),
    db.order.count({ where: { status: { in: [OrderStatus.FAILED, OrderStatus.CANCELLED] }, updatedAt: { gte: today } } }),
    db.refund.count({ where: { status: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING, RefundStatus.FAILED] } } }),
    db.productRequest.count({ where: { status: { in: [ProductRequestStatus.PENDING, ProductRequestStatus.CHECKING] } } }),
    db.productRequest.count({ where: { status: ProductRequestStatus.CHECKING, updatedAt: { lte: new Date(now.getTime() - 24 * 60 * 60_000) } } }),
    db.payment.count({ where: { OR: [{ status: PaymentStatus.RECONCILIATION_REQUIRED }, { status: PaymentStatus.SUCCESS, orderId: null }] } }),
    db.incident.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }),
    db.orderItemSourcing.count({ where: { status: "PRICE_PENDING" } }),
    db.order.count({ where: { status: OrderStatus.FINDING_RUNNER, assignedRunnerId: null, findingRunnerAt: { lte: runnerCutoff } } }),
  ]);
  const attention = await db.order.findMany({ where: { status: "FINDING_RUNNER", assignedRunnerId: null, findingRunnerAt: { lte: runnerCutoff } }, take: 8, orderBy: { findingRunnerAt: "asc" }, select: { id: true, status: true, findingRunnerAt: true, user: { select: { firstName: true, lastName: true } } } });
  const counts = [["Orders today", todayOrders], ["Finding runner", findingRunner], ["Runner assigned", assigned], ["Sourcing", sourcing], ["Out for delivery", outForDelivery], ["Completed today", completed], ["Failed/cancelled today", failed], ["Refunds", refunds], ["New requests", requests]] as const;
  const exceptions = [["Payment reconciliation", paymentIssues, "/admin/payments"], ["Open incidents", openIncidents, "/admin/exceptions"], ["Price approvals", waitingPrices, "/admin/exceptions"], ["Runner overdue", abandoned, "/admin/orders?status=FINDING_RUNNER"], ["Requests checking over 24h", staleRequests, "/admin/requests?status=CHECKING"]] as const;
  return <main className="min-h-screen bg-[#f7f5ee]"><div className="packam-container py-8"><p className="text-xs font-black uppercase tracking-widest text-black/40">Operations · Today</p><h1 className="mt-2 text-3xl font-black">What needs attention?</h1><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{counts.map(([label,count])=><section key={label} className="rounded-2xl bg-white p-4"><p className="text-xs font-bold text-black/45">{label}</p><p className="mt-1 text-3xl font-black">{count}</p></section>)}</div><h2 className="mt-8 text-xl font-black">Needs attention</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{exceptions.map(([label,count,href])=><Link key={label} href={href} className="flex justify-between rounded-2xl bg-white p-4"><span className="font-bold">{label}</span><strong className={count ? "text-red-700" : "text-black/45"}>{count}</strong></Link>)}</div><section className="mt-8 rounded-2xl bg-white p-5"><div className="flex justify-between"><h2 className="font-black">Oldest unclaimed orders</h2><Link href="/admin/orders?status=FINDING_RUNNER" className="text-sm font-bold underline">All orders</Link></div>{attention.length ? <ul className="mt-3 divide-y divide-black/5">{attention.map((order)=><li key={order.id} className="flex justify-between py-3 text-sm"><span>{order.user.firstName} {order.user.lastName} · {statusNames[order.status]}</span><Link className="font-bold underline" href={`/admin/orders/${order.id}`}>Open order</Link></li>)}</ul> : <p className="mt-3 text-sm text-black/50">No overdue runner offers.</p>}</section></div></main>;
}
