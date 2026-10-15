import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth-guard";
import { db } from "../../../../lib/db";
import { PriceDecision } from "../../../../components/orders/PriceDecision";
import { ReorderButton } from "../../../../components/orders/ReorderButton";
import { PrintTrackingRefresher } from "../../../../components/student/PrintTrackingRefresher";
import { formatCampusTime, isFinalOrderStatus, orderProgress, orderStatusLabel, orderStatusMessage, shortReference } from "../../../../lib/student-copy";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRole("STUDENT", `/orders/${encodeURIComponent(id)}`);
  const order = await db.order.findFirst({
    where: { id, userId: session.user.id },
    include: {
      items: {
        include: {
          sourcing: {
            include: {
              orderSource: {
                include: { vendor: { select: { name: true } } },
              },
            },
          },
        },
      },
      statusHistory: { orderBy: { createdAt: "asc" } },
      assignedRunner: { include: { user: { select: { firstName: true } } } },
    },
  });
  if (!order) notFound();

  const progress = orderProgress(order.status);
  const decisionNeeded = order.items.some((item) => item.sourcing.some((source) => source.status === "PRICE_PENDING"));

  return (
    <main className="min-h-screen bg-[#fffdf7] pb-16">
      <div className="packam-container py-6 sm:py-10">
        <Link href="/orders" className="inline-flex min-h-11 items-center text-sm font-bold text-black/65 hover:text-black">← All orders</Link>

        <header className="pk-card mt-2 p-5 sm:p-7">
          <p className="pk-eyebrow">Order {shortReference(order.id)} · {formatCampusTime(order.createdAt)}</p>
          <h1 className="pk-page-title mt-2">{orderStatusLabel(order.status)}</h1>
          <p className="pk-muted mt-2 max-w-2xl text-sm leading-6 sm:text-base">{orderStatusMessage(order.status, { total: order.total, runnerName: order.assignedRunner?.user.firstName })}</p>
          {decisionNeeded && <p role="status" className="mt-3"><span className="pk-pill pk-pill-warning">Action needed: a price changed — choose below</span></p>}
          {!isFinalOrderStatus(order.status) && <PrintTrackingRefresher />}

          {progress && (
            <ol className="mt-6 grid grid-cols-5 gap-1.5" aria-label="Delivery progress">
              {progress.map((step) => (
                <li key={step.label} className="min-w-0">
                  <span className={`block h-1.5 rounded-full ${step.state === "upcoming" ? "bg-black/10" : step.state === "current" ? "bg-[#feb80a]" : "bg-black"}`} aria-hidden="true" />
                  <span className={`mt-2 block text-[0.6875rem] leading-4 sm:text-xs ${step.state === "upcoming" ? "text-black/50" : "font-bold text-black"}`}>
                    {step.label}
                    <span className="sr-only"> — {step.state === "done" ? "done" : step.state === "current" ? "in progress" : "not yet"}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
          <div className="space-y-5">
            <section className="pk-card p-5 sm:p-6" aria-labelledby="order-items-heading">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="order-items-heading" className="text-lg font-black">Items</h2>
                <span className="pk-muted text-xs font-semibold">{order.items.length} {order.items.length === 1 ? "item" : "items"}</span>
              </div>
              <div className="mt-2 divide-y divide-black/5">{order.items.map((item) => (
                <article key={item.id} className="py-4 first:pt-3 last:pb-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-sm font-bold leading-5">{item.productName} <span className="pk-muted font-semibold">× {item.quantity}</span></p>
                    <strong className="shrink-0 whitespace-nowrap text-sm">₦{item.totalPrice.toLocaleString()}</strong>
                  </div>
                  {item.sourcing.map((source) => <div key={source.id} className="mt-3 rounded-xl border border-[#f0dfaa] bg-[#fff8df] p-3 text-sm leading-5">
                    {source.status === "PRICE_PENDING"
                      ? <><p className="font-bold">Price changed at {source.orderSource.vendor.name} 👀</p><p className="mt-1 text-sm leading-5 text-black/75">{item.productName} costs ₦{source.actualUnitPrice?.toLocaleString()} each there; you paid ₦{source.catalogueUnitPrice.toLocaleString()} each. Your runner is waiting for your choice.</p><PriceDecision orderId={order.id} sourcingId={source.id} orderTotal={order.total} /></>
                      : <p>{source.status === "UNAVAILABLE" ? `${item.productName} wasn’t available at ${source.orderSource.vendor.name}.` : `${source.quantity} picked up from ${source.orderSource.vendor.name}.`}</p>}
                  </div>)}
                </article>
              ))}</div>
            </section>

            <section className="pk-card p-5 sm:p-6" aria-labelledby="order-updates-heading">
              <h2 id="order-updates-heading" className="text-lg font-black">Updates</h2>
              <ol className="mt-4 space-y-4" aria-label="Order status history">{order.statusHistory.slice().reverse().map((entry, index) => (
                <li key={entry.id} className="flex gap-3 text-sm">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${index === 0 ? "bg-[#feb80a] ring-4 ring-[#fff4c7]" : "bg-black/30"}`} aria-hidden="true" />
                  <span className="min-w-0"><strong className="block leading-5">{orderStatusLabel(entry.status)}</strong><span className="pk-muted mt-0.5 block text-xs leading-5">{formatCampusTime(entry.createdAt)}</span></span>
                </li>
              ))}</ol>
            </section>
          </div>

          <aside className="space-y-5 lg:sticky lg:top-24">
            <section className="pk-card p-5" aria-labelledby="summary-heading">
              <h2 id="summary-heading" className="text-sm font-black">Payment summary</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="pk-muted">Items</dt><dd className="font-semibold">₦{order.subtotal.toLocaleString()}</dd></div>
                <div className="flex justify-between"><dt className="pk-muted">Delivery</dt><dd className="font-semibold">₦{order.deliveryFee.toLocaleString()}</dd></div>
                <div className="flex justify-between border-t border-black/10 pt-3 text-base font-black"><dt>Total paid</dt><dd>₦{order.total.toLocaleString()}</dd></div>
              </dl>
            </section>

            <section className="pk-card p-5" aria-labelledby="delivery-heading">
              <h2 id="delivery-heading" className="text-sm font-black">Delivering to</h2>
              <p className="mt-2 break-words text-sm leading-5">{order.deliveryAddress}</p>
              {order.deliveryInstructions && <p className="pk-muted mt-1 break-words text-sm leading-5">{order.deliveryInstructions}</p>}
              {order.assignedRunner && <p className="mt-3 text-sm">Runner: <strong>{order.assignedRunner.user.firstName}</strong></p>}
            </section>

            <section className="pk-card space-y-3 p-5">
              <ReorderButton items={order.items.map((item) => ({ productId: item.productId, name: item.productName, quantity: item.quantity }))} />
              <Link href="/support" className="pk-btn pk-btn-ghost pk-btn-sm -ml-2">Need help with this order? Contact support →</Link>
              <p className="pk-muted text-xs">Quote order <strong>{shortReference(order.id)}</strong> when you contact us.</p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
