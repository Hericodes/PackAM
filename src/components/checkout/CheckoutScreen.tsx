import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireRole } from "../../lib/auth-guard";
import { db } from "../../lib/db";
import { CheckoutClient } from "./CheckoutClient";
import { priceCart } from "../../lib/cart-pricing";
import { readDeliveryTierQuotes } from "../../lib/delivery-tier-store";
import { describeDetails } from "../../lib/food/plate";
import { describeOptions } from "../../lib/products/variants";
import { checkoutProvider } from "../../lib/payments/gateways";
import { orderingClock } from "../../lib/ordering-hours";
import { providerName } from "../../lib/payments/provider-selection";
import { CHECKOUT_PATH, type CartSection } from "../../lib/food/cart-context";

/** Where "Keep browsing" goes from each checkout. */
const BROWSE_PATH: Record<CartSection, string> = { stuff: "/search", food: "/food" };

const snapshotIsFood = (snapshot: Prisma.JsonValue | null) =>
  Boolean(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && typeof (snapshot as Prisma.JsonObject).shopId === "string");

/** A recent payment for this cart we haven't confirmed yet; warn before the student pays again. */
async function findUnconfirmedPayment(userId: string, section: CartSection) {
  const recent = await db.payment.findMany({
    where: {
      userId,
      orderId: null,
      printJobId: null,
      status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] },
      cashierUrl: { not: null },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { transactionReference: true, amount: true, checkoutSnapshot: true },
  });
  return recent.find((payment) => snapshotIsFood(payment.checkoutSnapshot) === (section === "food")) ?? null;
}

/**
 * One checkout page: the shop cart (/checkout) or the food cart (/checkout/food). Each shows and charges only its
 * own cart's lines; the other cart stays as it is. An empty cart goes to /cart, which finds the one with items.
 */
export async function CheckoutScreen({ section }: { section: CartSection }) {
  const session = await requireRole("STUDENT", CHECKOUT_PATH[section]);
  const [cart, unconfirmedPayment, tierQuotes] = await Promise.all([
    // Every price here is the server's: product prices, and plates priced as base + soup + extras.
    priceCart(db, session.user.id, section),
    findUnconfirmedPayment(session.user.id, section),
    // Every delivery speed with its current server price and window, read fresh for each visit (never cached).
    // Before the delivery-tier migration this is Cruise Mode only, at ₦200.
    readDeliveryTierQuotes(db),
  ]);
  // Delivery always starts from the phone's live location, so saved locations aren't loaded here.

  const payWith = providerName(checkoutProvider());
  if (!cart.lines.length) redirect("/cart");
  const shopName = cart.context.kind === "food" ? cart.shop?.name ?? cart.context.shopName : null;
  return (
    <main className="min-h-screen pb-32 lg:pb-20">
      <div className="packam-container pt-5 sm:pt-10">
        <Link href={BROWSE_PATH[section]} className="inline-flex min-h-11 items-center text-sm font-bold text-black/55 transition hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black">{section === "food" ? "← Back to Food" : "← Keep shopping"}</Link>
        <div className="mt-4 max-w-2xl">
          <p className="pk-eyebrow">{section === "food" ? "🍲 Food checkout" : "🛒 Shop checkout"}</p>
          <h1 className="pk-page-title mt-2">{section === "food" ? (shopName ? `Your food from ${shopName}` : "Your food order") : "Checkout"}</h1>
          <p className="pk-muted mt-2 text-sm leading-6">Choose where to deliver and how fast, check your {section === "food" ? "food" : "items"}, then pay securely with {payWith}. You’ll see the full total, including delivery, before paying.</p>
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
            section={section}
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
            shopName={shopName}
            problems={cart.problems}
            tiers={tierQuotes.quotes}
            ordering={orderingClock()}
          />
        </div>
      </div>
    </main>
  );
}
