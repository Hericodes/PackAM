import Link from "next/link";
import { requireRole } from "../../lib/auth-guard";
import { OrderStatus, PaymentStatus, PrintJobStatus, ProductRequestStatus, RefundStatus } from "@prisma/client";
import { db } from "../../lib/db";
import { getRunnerAcceptanceTimeoutMinutes } from "../../lib/orders/price-policy";
import { orphanedSuccessfulMarketplacePaymentWhere } from "../../lib/payments/orphaned-marketplace-payment";
import { orderStatusDisplay } from "../../lib/ops-status";
import { formatCampusTime } from "../../lib/student-copy";
import { StatusBadge } from "../../components/ui/StatusBadge";

const PRINT_IN_PROGRESS: PrintJobStatus[] = [PrintJobStatus.RUNNER_ASSIGNED, PrintJobStatus.DOCUMENT_RECEIVED, PrintJobStatus.PRINTING, PrintJobStatus.PRINTED, PrintJobStatus.OUT_FOR_DELIVERY];
const PRINT_ISSUES: PrintJobStatus[] = [PrintJobStatus.DOCUMENT_UNREADABLE, PrintJobStatus.PRINT_FAILED];

type Metric = { label: string; value: number; href?: string; hint?: string };

function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{metrics.map((metric) => {
    const body = <><p className="text-xs font-bold text-black/50">{metric.label}</p><p className="mt-1 text-3xl font-black tabular-nums">{metric.value}</p>{metric.hint && <p className="mt-1 text-[0.6875rem] text-black/45">{metric.hint}</p>}</>;
    return metric.href
      ? <Link key={metric.label} href={metric.href} className="rounded-2xl bg-white p-4 transition hover:ring-1 hover:ring-black/15">{body}</Link>
      : <section key={metric.label} className="rounded-2xl bg-white p-4">{body}</section>;
  })}</div>;
}

export default async function AdminHomePage() {
  await requireRole("ADMIN");
  const now = new Date(); const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now); const today = new Date(`${localDay}T00:00:00.000+01:00`); const runnerCutoff = new Date(now.getTime() - getRunnerAcceptanceTimeoutMinutes() * 60_000);
  const [
    todayOrders, findingRunner, assigned, sourcing, outForDelivery, completed, failed, refunds, requests, staleRequests, paymentIssues, openIncidents, waitingPrices, abandoned,
    printFinding, printInProgress, printIssues, printRefunds, printDeliveredToday, activeProducts, inactiveProducts, activeWithoutPhoto,
  ] = await Promise.all([
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
    db.payment.count({ where: { OR: [{ status: PaymentStatus.RECONCILIATION_REQUIRED }, orphanedSuccessfulMarketplacePaymentWhere] } }),
    db.incident.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }),
    db.orderItemSourcing.count({ where: { status: "PRICE_PENDING" } }),
    db.order.count({ where: { status: OrderStatus.FINDING_RUNNER, assignedRunnerId: null, findingRunnerAt: { lte: runnerCutoff } } }),
    db.printJob.count({ where: { status: PrintJobStatus.FINDING_RUNNER } }),
    db.printJob.count({ where: { status: { in: PRINT_IN_PROGRESS } } }),
    db.printJob.count({ where: { status: { in: PRINT_ISSUES } } }),
    db.printJob.count({ where: { status: PrintJobStatus.REFUND_PROCESSING } }),
    db.printJobStatusHistory.count({ where: { status: PrintJobStatus.DELIVERED, createdAt: { gte: today } } }),
    db.product.count({ where: { status: "ACTIVE" } }),
    db.product.count({ where: { status: "INACTIVE" } }),
    db.product.count({ where: { status: "ACTIVE", imageUrl: null } }),
  ]);
  const attention = await db.order.findMany({ where: { status: "FINDING_RUNNER", assignedRunnerId: null, findingRunnerAt: { lte: runnerCutoff } }, take: 8, orderBy: { findingRunnerAt: "asc" }, select: { id: true, status: true, findingRunnerAt: true, total: true, user: { select: { firstName: true, lastName: true } } } });

  const exceptions = [
    ["Payment reconciliation", paymentIssues, "/admin/payments"],
    ["Open incidents", openIncidents, "/admin/exceptions"],
    ["Price approvals waiting", waitingPrices, "/admin/exceptions"],
    ["Orders with no runner (overdue)", abandoned, "/admin/orders?status=FINDING_RUNNER"],
    ["Print jobs with a problem", printIssues, "/admin/print-jobs?status=ISSUES"],
    ["Requests checking over 24h", staleRequests, "/admin/requests?status=CHECKING"],
  ] as const;
  const urgent = exceptions.filter(([, count]) => count > 0).length;

  return <main className="min-h-screen"><div className="packam-container py-8">
    <p className="text-xs font-black uppercase tracking-widest text-black/40">Operations · Today</p>
    <h1 className="mt-2 text-3xl font-black">What needs attention?</h1>
    <p className="mt-1 text-sm text-black/55">{urgent ? `${urgent} ${urgent === 1 ? "area needs" : "areas need"} action.` : "Nothing urgent right now. Campus dey calm 🫡"}</p>

    <section aria-labelledby="attention-heading" className="mt-6">
      <h2 id="attention-heading" className="sr-only">Needs attention</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{exceptions.map(([label, count, href]) => <li key={label}>
        <Link href={href} className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl p-4 ${count ? "bg-[#ffe9e7] ring-1 ring-[#c92d24]/20" : "bg-white"}`}>
          <span className="font-bold">{label}</span>
          <strong className={`text-lg tabular-nums ${count ? "text-[#c92d24]" : "text-black/35"}`}>{count}</strong>
        </Link>
      </li>)}</ul>
    </section>

    <section aria-labelledby="orders-heading" className="mt-8">
      <div className="flex items-end justify-between"><h2 id="orders-heading" className="text-xl font-black">Marketplace orders</h2><Link href="/admin/orders" className="text-sm font-bold underline">All orders</Link></div>
      <MetricGrid metrics={[
        { label: "Orders today", value: todayOrders, href: "/admin/orders" },
        { label: "Finding runner", value: findingRunner, href: "/admin/orders?status=FINDING_RUNNER" },
        { label: "Runner assigned", value: assigned, href: "/admin/orders?status=RUNNER_ASSIGNED" },
        { label: "Sourcing", value: sourcing, href: "/admin/orders?status=SOURCING_PRODUCT" },
        { label: "Out for delivery", value: outForDelivery, href: "/admin/orders?status=OUT_FOR_DELIVERY" },
        { label: "Delivered today", value: completed, href: "/admin/orders?status=DELIVERED" },
        { label: "Failed/cancelled today", value: failed },
        { label: "Open refunds", value: refunds, hint: "Pending, processing or failed", href: "/admin/payments" },
      ]} />
    </section>

    <section aria-labelledby="printing-heading" className="mt-8">
      <div className="flex items-end justify-between"><h2 id="printing-heading" className="text-xl font-black">Printing</h2><Link href="/admin/print-jobs" className="text-sm font-bold underline">All print jobs</Link></div>
      <MetricGrid metrics={[
        { label: "Finding runner", value: printFinding, href: "/admin/print-jobs?status=FINDING_RUNNER" },
        { label: "In progress", value: printInProgress, hint: "Runner assigned → delivery", href: "/admin/print-jobs?status=IN_PROGRESS" },
        { label: "Problems", value: printIssues, hint: "Unreadable or print failed", href: "/admin/print-jobs?status=ISSUES" },
        { label: "Refund processing", value: printRefunds, href: "/admin/print-jobs?status=REFUND_PROCESSING" },
        { label: "Delivered today", value: printDeliveredToday, href: "/admin/print-jobs?status=DELIVERED" },
      ]} />
    </section>

    <section aria-labelledby="catalogue-heading" className="mt-8">
      <div className="flex items-end justify-between"><h2 id="catalogue-heading" className="text-xl font-black">Catalogue & requests</h2><Link href="/admin/products" className="text-sm font-bold underline">Manage products</Link></div>
      <MetricGrid metrics={[
        { label: "Active products", value: activeProducts, href: "/admin/products?status=ACTIVE" },
        { label: "Inactive products", value: inactiveProducts, href: "/admin/products?status=INACTIVE" },
        { label: "Active without photo", value: activeWithoutPhoto, hint: "Students see a placeholder" },
        { label: "Open product requests", value: requests, href: "/admin/requests" },
      ]} />
    </section>

    <section className="mt-8 rounded-2xl bg-white p-5">
      <div className="flex justify-between gap-3"><h2 className="font-black">Oldest unclaimed orders</h2><Link href="/admin/orders?status=FINDING_RUNNER" className="text-sm font-bold underline">All waiting orders</Link></div>
      {attention.length ? <ul className="mt-3 divide-y divide-black/5">{attention.map((order) => {
        const display = orderStatusDisplay(order.status);
        return <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <span className="flex flex-wrap items-center gap-2"><strong>{order.user.firstName} {order.user.lastName}</strong><StatusBadge label={display.label} tone={display.tone} /><span className="text-black/50">since {order.findingRunnerAt ? formatCampusTime(order.findingRunnerAt) : "—"} · ₦{order.total.toLocaleString()}</span></span>
          <Link className="inline-flex min-h-10 items-center font-bold underline" href={`/admin/orders/${order.id}`}>Open order</Link>
        </li>;
      })}</ul> : <p className="mt-3 text-sm text-black/50">No overdue runner offers. Runners dey on top of am 🛵</p>}
    </section>
  </div></main>;
}
