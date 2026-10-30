import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth-guard";
import { db } from "../../../../lib/db";
import { PriceDecision } from "../../../../components/orders/PriceDecision";
import { ReorderButton } from "../../../../components/orders/ReorderButton";
import { PrintTrackingRefresher } from "../../../../components/student/PrintTrackingRefresher";
import { Icon } from "../../../../components/ui/Icon";
import { describeDetails, parseLineDetails } from "../../../../lib/food/plate";
import { optionsText } from "../../../../lib/products/variants";

/** A food plate's frozen contents ("Amala + Ewedu + Meat ×2"), or null for anything else. */
function plateOf(details: unknown) {
  const parsed = parseLineDetails(details);
  return parsed?.kind === "PLATE" ? describeDetails(parsed) : null;
}
import { formatCampusTime, isFinalOrderStatus, orderEventDescription, orderNextStep, orderProgress, orderStatusLabel, orderStatusMessage, orderTimeline, shortReference } from "../../../../lib/student-copy";

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
      shop: { select: { name: true } },
    },
  });
  if (!order) notFound();

  const progress = orderProgress(order.status);
  const timeline = orderTimeline(order.statusHistory);
  const nextStep = orderNextStep(order.status);
  const supportHref = `/support?order=${encodeURIComponent(order.id)}`;
  const decisionNeeded = order.items.some((item) => item.sourcing.some((source) => source.status === "PRICE_PENDING"));

  return (
    <main className="min-h-screen pb-16">
      <div className="packam-container py-6 sm:py-10">
        <Link href="/orders" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-black/65 hover:text-black"><Icon name="arrowLeft" className="h-4 w-4" /> All orders</Link>

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

          {nextStep && (
            <div className="mt-6 flex gap-3 rounded-2xl border border-[#feb80a]/35 bg-gradient-to-br from-[#fff4c7] to-[#fffaf0] p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#875a00] ring-1 ring-[#feb80a]/40"><Icon name={isFinalOrderStatus(order.status) ? "check" : "arrowRight"} className="h-[18px] w-[18px]" /></span>
              <div className="min-w-0">
                <h2 className="text-sm font-black">{isFinalOrderStatus(order.status) ? "Where things stand" : "What happens next"}</h2>
                <p className="mt-0.5 text-sm leading-6 text-black/75">{nextStep}</p>
              </div>
            </div>
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
                  {plateOf(item.details) && <p className="mt-1 text-sm leading-5 text-black/65">{plateOf(item.details)}</p>}
                  {optionsText(item.details) && <p className="mt-1 text-sm leading-5 text-black/65">{optionsText(item.details)}</p>}
                  {item.sourcing.map((source) => <div key={source.id} className="mt-3 rounded-xl border border-[#f0dfaa] bg-[#fff8df] p-3 text-sm leading-5">
                    {source.status === "PRICE_PENDING"
                      ? <><p className="font-bold">Price changed at {source.orderSource.vendor.name} 👀</p><p className="mt-1 text-sm leading-5 text-black/75">{item.productName} costs ₦{source.actualUnitPrice?.toLocaleString()} each there; you paid ₦{source.catalogueUnitPrice.toLocaleString()} each. Your runner is waiting for your choice.</p><PriceDecision orderId={order.id} sourcingId={source.id} orderTotal={order.total} /></>
                      : <p>{source.status === "UNAVAILABLE" ? `${item.productName} wasn’t available at ${source.orderSource.vendor.name}.` : `${source.quantity} picked up from ${source.orderSource.vendor.name}.`}</p>}
                  </div>)}
                </article>
              ))}</div>
            </section>

            <section className="pk-card p-5 sm:p-6" aria-labelledby="order-updates-heading">
              <h2 id="order-updates-heading" className="text-lg font-black">Order timeline</h2>
              <p className="pk-muted mt-1 text-xs">Every status change on this order, oldest first. Times are campus time.</p>
              <ol className="mt-4" aria-label="Order status history">{timeline.map((entry, index) => {
                const latest = index === timeline.length - 1;
                const description = orderEventDescription(entry.status);
                return (
                  <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {!latest && <span className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-black/10" aria-hidden="true" />}
                    <span className={`relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${latest ? "bg-[#feb80a] ring-4 ring-[#fff4c7]" : "bg-black text-white"}`} aria-hidden="true">
                      {latest ? <span className="h-2 w-2 rounded-full bg-black" /> : <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.6} />}
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="font-bold leading-6">{orderStatusLabel(entry.status)}{latest && <span className="sr-only"> (latest)</span>}</p>
                      {description && <p className="leading-5 text-black/70">{description}</p>}
                      <p className="pk-muted mt-0.5 text-xs leading-5"><time dateTime={entry.createdAt.toISOString()}>{formatCampusTime(entry.createdAt)}</time></p>
                    </div>
                  </li>
                );
              })}</ol>
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
              <h2 id="delivery-heading" className="flex items-center gap-2 text-sm font-black"><Icon name="mapPin" className="h-4 w-4 text-[#875a00]" /> Delivering to</h2>
              <p className="mt-2 break-words text-sm leading-5">{order.deliveryAddress}</p>
              {order.deliveryInstructions && <p className="pk-muted mt-1 break-words text-sm leading-5">{order.deliveryInstructions}</p>}
              {order.assignedRunner && <p className="mt-3 text-sm">Runner: <strong>{order.assignedRunner.user.firstName}</strong></p>}
            </section>

            <section className="pk-card p-5" aria-labelledby="order-help-heading">
              <h2 id="order-help-heading" className="flex items-center gap-2 text-sm font-black"><Icon name="help" className="h-4 w-4 text-[#875a00]" /> Problem with this order?</h2>
              <p className="pk-muted mt-1 text-sm leading-5">Missing or wrong items, damage, delivery or payment issues — send it to our team with this order attached.</p>
              <Link href={supportHref} className="pk-btn pk-btn-secondary mt-3 w-full">
                <Icon name="message" className="h-4 w-4" /> Report a problem
              </Link>
              <p className="pk-muted mt-2 text-xs">Order reference: <strong className="text-black">{shortReference(order.id)}</strong></p>
            </section>

            {/* Food is reordered from its shop's menu, where every choice and price is checked again. */}
            {order.shopId ? (
              <section className="pk-card p-5">
                <p className="text-sm font-bold">From {order.shop?.name ?? "a food shop"}</p>
                <Link href={`/food/${order.shopId}`} className="pk-btn pk-btn-secondary mt-3 w-full">Order from this shop again</Link>
              </section>
            ) : (
              <section className="pk-card p-5">
                <ReorderButton items={order.items.map((item) => ({ productId: item.productId, name: item.productName, quantity: item.quantity, variantId: item.variantId }))} />
              </section>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
