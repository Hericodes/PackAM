import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth-guard";
import { db } from "../../../../lib/db";
import { PriceDecision } from "../../../../components/orders/PriceDecision";

const labels: Record<string, string> = {
  PAYMENT_CONFIRMED: "Payment confirmed", FINDING_RUNNER: "Finding a runner", RUNNER_ASSIGNED: "Runner assigned",
  SOURCING_PRODUCT: "Getting your items", OUT_FOR_DELIVERY: "On the way", DELIVERED: "Delivered",
  REFUND_PROCESSING: "Refund processing", REFUNDED: "Refunded", FAILED: "Payment failed", CANCELLED: "Cancelled",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("STUDENT", "/orders");
  const { id } = await params;
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

  return (
    <main className="min-h-screen bg-[#fffdf7]">
      <div className="packam-container py-6 sm:py-10">
        <Link href="/orders" className="inline-flex min-h-11 items-center text-sm font-bold text-black/55 transition hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">← All orders</Link>
        <section className="mt-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:mt-5 sm:rounded-3xl sm:p-8">
          <header className="border-b border-black/5 pb-5 sm:pb-6">
            <p className="text-xs font-black uppercase tracking-wider text-black/45">Order {order.id.slice(-8).toUpperCase()}</p>
            <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{labels[order.status] ?? order.status.replaceAll("_", " ")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-black/60">{order.status === "FINDING_RUNNER" ? "Payment confirmed ✓ We’re finding someone to bring your stuff. 🫡" : order.status === "REFUND_PROCESSING" ? "Your refund request is being processed." : order.status === "OUT_FOR_DELIVERY" ? "Your runner is on the way." : "Track updates for your order here."}</p>
            {order.assignedRunner && <p className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-[#f7f5ee] px-3 text-sm">Runner: <strong className="ml-1">{order.assignedRunner.user.firstName}</strong></p>}
          </header>

          <section className="pt-5 sm:pt-6" aria-labelledby="order-items-heading">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="order-items-heading" className="text-lg font-black">Items</h2>
              <span className="text-xs font-semibold text-black/50">{order.items.length} {order.items.length === 1 ? "item" : "items"}</span>
            </div>
            <div className="mt-2 divide-y divide-black/5">{order.items.map((item) => (
              <article key={item.id} className="py-4 first:pt-3 last:pb-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-sm font-bold leading-5">{item.productName} × {item.quantity}</p>
                  <strong className="shrink-0 whitespace-nowrap text-sm">₦{item.totalPrice.toLocaleString()}</strong>
                </div>
                {item.sourcing.map((source) => <div key={source.id} className="mt-3 rounded-xl border border-[#f0dfaa] bg-[#fff8df] p-3 text-sm leading-5">
                  <p>{source.status === "UNAVAILABLE" ? `${item.productName} unavailable at ${source.orderSource.vendor.name}.` : `${source.quantity} sourced from ${source.orderSource.vendor.name}${source.actualUnitPrice !== null ? ` at ₦${source.actualUnitPrice.toLocaleString()} each` : ""}.`}</p>
                  {source.status === "PRICE_PENDING" && <><p className="mt-2 text-sm leading-5 text-black/75">Checkout price ₦{source.catalogueUnitPrice.toLocaleString()} each. Please choose how to continue.</p><PriceDecision orderId={order.id} sourcingId={source.id} /></>}
                </div>)}
              </article>
            ))}</div>
          </section>

          <section className="mt-5 rounded-2xl bg-[#f7f5ee] p-4 sm:p-5" aria-labelledby="delivery-heading">
            <h2 id="delivery-heading" className="text-sm font-black">Delivery</h2>
            <p className="mt-2 break-words text-sm leading-5">{order.deliveryAddress}</p>
            {order.deliveryInstructions && <p className="mt-1 break-words text-sm leading-5 text-black/55">{order.deliveryInstructions}</p>}
            <p className="mt-4 flex items-baseline justify-between gap-3 border-t border-black/10 pt-4 text-base font-black"><span>Total paid</span><span className="whitespace-nowrap">₦{order.total.toLocaleString()}</span></p>
          </section>

          <section className="mt-7 border-t border-black/5 pt-5 sm:mt-8 sm:pt-6" aria-labelledby="order-updates-heading">
            <h2 id="order-updates-heading" className="text-lg font-black">Updates</h2>
            <ol className="mt-4 space-y-4" aria-label="Order status history">{order.statusHistory.map((entry) => (
              <li key={entry.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-black" aria-hidden="true"/>
                <span className="min-w-0"><strong className="block leading-5">{labels[entry.status] ?? entry.status.replaceAll("_", " ")}</strong><span className="mt-0.5 block break-words text-xs leading-5 text-black/50">{entry.createdAt.toLocaleString()}{entry.note ? ` · ${entry.note}` : ""}</span></span>
              </li>
            ))}</ol>
          </section>
        </section>
      </div>
    </main>
  );
}
