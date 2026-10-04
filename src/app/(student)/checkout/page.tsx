import Link from "next/link";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";
import { redirect } from "next/navigation";
import { CheckoutClient } from "../../../components/checkout/CheckoutClient";
import { CHECKOUT_DELIVERY_FEE } from "../../../lib/checkout-pricing";

export default async function CheckoutPage() {
  const session = await requireRole("STUDENT", "/checkout");
  const [cart, locations] = await Promise.all([
    db.cart.findUnique({
      where: { userId: session.user.id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                customerPrice: true,
                category: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    db.savedLocation.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        address: true,
        instructions: true,
        latitude: true,
        longitude: true,
      },
    }),
  ]);

  const items = cart?.items ?? [];
  if (!items.length) redirect("/search");
  return (
    <main className="min-h-screen bg-[#fffdf7] pb-32 lg:pb-20">
      <div className="packam-container pt-5 sm:pt-10">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-bold text-black/55 transition hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black">← Keep browsing</Link>
        <div className="mt-4 max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-black/45">Secure checkout</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Checkout</h1>
          <p className="mt-2 text-sm leading-6 text-black/60">Choose a delivery location, review your items, then pay securely with OPay.</p>
        </div>
        <div className="mt-5 sm:mt-7">
          <CheckoutClient
            items={items.map((item) => ({
              id: item.id,
              quantity: item.quantity,
              product: {
                ...item.product,
                category: item.product.category.name,
              },
            }))}
            deliveryFee={CHECKOUT_DELIVERY_FEE}
            locations={locations}
          />
        </div>
      </div>
    </main>
  );
}

