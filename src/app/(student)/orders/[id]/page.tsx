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
    <main className="min-h-screen bg-[#fffdf7]"><div className="packam-container py-10">
      <Link href="/orders" className="text-sm font-bold text-black/50">← All orders</Link>
      <section className="mt-5 rounded-3xl border border-black/5 bg-white p-5 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-black/40">Order {order.id.slice(-8).toUpperCase()}</p>
        <h1 className="mt-2 text-3xl font-black">{labels[order.status] ?? order.status.replaceAll("_", " ")}</h1>
        <p className="mt-2 text-sm text-black/55">{order.status === "FINDING_RUNNER" ? "Payment confirmed ✓ We’re finding someone to bring your stuff. 🫡" : order.status === "REFUND_PROCESSING" ? "Your refund request is being processed." : order.status === "OUT_FOR_DELIVERY" ? "Your runner is on the way." : "Track updates for your order here."}</p>
        {order.assignedRunner && <p className="mt-2 text-sm">Runner: <strong>{order.assignedRunner.user.firstName}</strong></p>}
        <h2 className="mt-8 font-black">Items</h2>
        <div className="mt-2 divide-y divide-black/5">{order.items.map((item) => (
          <div key={item.id} className="py-3">
            <div className="flex justify-between gap-3 text-sm"><span>{item.productName} × {item.quantity}</span><strong>₦{item.totalPrice.toLocaleString()}</strong></div>
            {item.sourcing.map((source) => <div key={source.id} className="mt-2 rounded-xl bg-[#fff8df] p-3 text-sm">
              <p>{source.status === "UNAVAILABLE" ? `${item.productName} unavailable at ${source.orderSource.vendor.name}.` : `${source.quantity} sourced from ${source.orderSource.vendor.name}${source.actualUnitPrice !== null ? ` at ₦${source.actualUnitPrice.toLocaleString()} each` : ""}.`}</p>
              {source.status === "PRICE_PENDING" && <><p className="mt-1 text-xs text-black/60">Checkout price ₦{source.catalogueUnitPrice.toLocaleString()} each. Please choose how to continue.</p><PriceDecision orderId={order.id} sourcingId={source.id} /></>}
            </div>)}
          </div>
        ))}</div>
        <div className="mt-5 border-t border-black/5 pt-4 text-sm"><p>Delivery to: {order.deliveryAddress}</p>{order.deliveryInstructions && <p className="mt-1 text-black/55">{order.deliveryInstructions}</p>}<p className="mt-3 flex justify-between text-base font-black"><span>Total paid</span><span>₦{order.total.toLocaleString()}</span></p></div>
        <h2 className="mt-8 font-black">Updates</h2>
        <ol className="mt-3 space-y-3">{order.statusHistory.map((entry) => <li key={entry.id} className="flex gap-3 text-sm"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-black"/><span><strong>{labels[entry.status] ?? entry.status.replaceAll("_", " ")}</strong><span className="block text-xs text-black/45">{entry.createdAt.toLocaleString()}{entry.note ? ` · ${entry.note}` : ""}</span></span></li>)}</ol>
      </section>
    </div></main>
  );
}
