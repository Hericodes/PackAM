import Link from "next/link";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";
import { redirect } from "next/navigation";
import { CheckoutClient } from "../../../components/checkout/CheckoutClient";
import { priceCart } from "../../../lib/cart-pricing";
import { readDeliveryTierQuotes } from "../../../lib/delivery-tier-store";
import { describeDetails } from "../../../lib/food/plate";
import { describeOptions } from "../../../lib/products/variants";
import { checkoutProvider } from "../../../lib/payments/gateways";
import { orderingClock } from "../../../lib/ordering-hours";
import { providerName } from "../../../lib/payments/provider-selection";

/** A recent marketplace payment we haven't confirmed yet; warn before the student pays again. */
function findUnconfirmedPayment(userId: string) {
  return db.payment.findFirst({
    where: {
      userId,
      orderId: null,
      printJobId: null,
      status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] },
      cashierUrl: { not: null },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { transactionReference: true, amount: true },
  });
}

export default async function CheckoutPage() {
  const session = await requireRole("STUDENT", "/checkout");
  const [cart, unconfirmedPayment, tierQuotes] = await Promise.all([
    // Every price here is the server's: product prices, and plates priced as base + soup + extras.
    priceCart(db, session.user.id),
    findUnconfirmedPayment(session.user.id),
    // Every delivery speed with its current server price and window, read fresh for each visit (never cached).
    // Before the delivery-tier migration this is Cruise Mode only, at ₦200.
    readDeliveryTierQuotes(db),
  ]);
  // Delivery always starts from the phone's live location, so saved locations aren't loaded here.

  const payWith = providerName(checkoutProvider());
  if (!cart.lines.length) redirect("/search");
  return (
    <main className="min-h-screen pb-32 lg:pb-20">
      <div className="packam-container pt-5 sm:pt-10">
        <Link href="/search" className="inline-flex min-h-11 items-center text-sm font-bold text-black/55 transition hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black">← Keep browsing</Link>
        <div className="mt-4 max-w-2xl">
          <p className="pk-eyebrow">Secure checkout</p>
          <h1 className="pk-page-title mt-2">Checkout</h1>
          <p className="pk-muted mt-2 text-sm leading-6">Choose where to deliver and how fast, check your items, then pay securely with {payWith}. You’ll see the full total, including delivery, before paying.</p>
        </div>
        {unconfirmedPayment?.transactionReference && (
          <section role="status" className="mt-5 max-w-2xl rounded-2xl border border-[#e8c238] bg-[#fff8df] p-4 text-sm leading-6">
            <p className="font-black">Hold on — you have a payment we’re still confirming (₦{unconfirmedPayment.amount.toLocaleString()}).</p>
            <p className="mt-1 text-black/70">If you already paid, check it first so you don’t pay twice.</p>
            <Link href={`/checkout/payment-result?reference=${encodeURIComponent(unconfirmedPayment.transactionReference)}`} className="mt-2 inline-flex min-h-11 items-center font-bold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">Check that payment →</Link>
          </section>
        )}
        <div className="mt-5 sm:mt-7">
          <CheckoutClient
            providerName={payWith}
            payByTransfer={checkoutProvider() === "MANUAL"}
            items={cart.lines.map((line) => ({
              id: line.cartItemId,
              quantity: line.quantity,
              // A ready-made meal's takeaway pack is part of its price: say so.
              name: line.details?.kind === "MEAL" && line.details.pack ? `${line.name} + takeaway pack` : line.name,
              imageUrl: line.imageUrl,
              category: line.category,
              unitPrice: line.unitPrice,
              plate: line.details?.kind === "PLATE" ? describeDetails(line.details) : null,
              options: line.details?.kind === "VARIANT" ? describeOptions(line.details.options) : null,
              problem: line.problem,
            }))}
            shopName={cart.context.kind === "food" ? cart.shop?.name ?? cart.context.shopName : null}
            problems={cart.problems}
            tiers={tierQuotes.quotes}
            ordering={orderingClock()}
          />
        </div>
      </div>
    </main>
  );
}

