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
    <main className="min-h-screen bg-[#fffdf7] pb-28 lg:pb-20">
      <div className="packam-container pt-6 sm:pt-10">
        <Link href="/" className="text-sm font-bold text-black/50 hover:text-black">← Keep browsing</Link>
        <h1 className="mt-5 text-3xl font-black tracking-tight sm:text-4xl">Checkout</h1>
        <div className="mt-6 sm:mt-8">
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



