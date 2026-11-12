import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";
import { cartSummary } from "../../../lib/cart-pricing";
import { CHECKOUT_PATH } from "../../../lib/food/cart-context";

export const metadata: Metadata = { title: "Your carts" };

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;
const items = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

/**
 * The navbar cart. PackAM has a food cart and a shop cart, each with its own checkout (printing has its own flow):
 * with only one filled, this goes straight to its checkout; with both, the student picks; with none, it points to
 * Food, Order Stuff and Printing.
 */
export default async function CartPage() {
  const session = await requireRole("STUDENT", "/cart");
  const summary = await cartSummary(db, session.user.id);
  if (summary.food.count && !summary.stuff.count) redirect(CHECKOUT_PATH.food);
  if (summary.stuff.count && !summary.food.count) redirect(CHECKOUT_PATH.stuff);

  return (
    <main className="min-h-screen pb-24">
      <div className="packam-container max-w-2xl pt-6 sm:pt-10">
        <p className="pk-eyebrow">Your carts</p>
        <h1 className="pk-page-title mt-2">{summary.count ? "Which order are you checking out?" : "Your carts are empty"}</h1>
        <p className="pk-muted mt-2 text-sm leading-6">
          {summary.count ? "Food and shop items are separate orders, each with its own checkout and delivery." : "Pick food from a campus shop, order provisions and other stuff, or send something to print."}
        </p>

        {summary.count ? (
          <ul className="mt-6 grid gap-3">
            <li>
              <Link href={CHECKOUT_PATH.food} className="group flex items-center gap-4 rounded-3xl border border-black/10 bg-white p-4 transition hover:border-black/25 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:p-5">
                <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#fff1d6] text-3xl">🍲</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-black">Food cart</span>
                  <span className="mt-0.5 block text-sm text-black/60">{items(summary.food.count)}{summary.food.shopName ? ` from ${summary.food.shopName}` : ""} · {naira(summary.food.subtotal)}</span>
                </span>
                <span className="pk-btn pk-btn-primary pk-btn-sm shrink-0">Check out</span>
              </Link>
            </li>
            <li>
              <Link href={CHECKOUT_PATH.stuff} className="group flex items-center gap-4 rounded-3xl border border-black/10 bg-white p-4 transition hover:border-black/25 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:p-5">
                <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#eef3ff] text-3xl">🛒</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-black">Shop cart</span>
                  <span className="mt-0.5 block text-sm text-black/60">{items(summary.stuff.count)} · {naira(summary.stuff.subtotal)}</span>
                </span>
                <span className="pk-btn pk-btn-primary pk-btn-sm shrink-0">Check out</span>
              </Link>
            </li>
          </ul>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Link href="/food" className="rounded-3xl bg-[#1f1300] p-5 text-white transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"><span aria-hidden="true" className="text-3xl">🍲</span><span className="mt-3 block font-black">Order food</span><span className="mt-1 block text-sm text-white/70">From campus shops</span></Link>
            <Link href="/search" className="rounded-3xl border border-black/10 bg-white p-5 transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"><span aria-hidden="true" className="text-3xl">🛒</span><span className="mt-3 block font-black">Order stuff</span><span className="mt-1 block text-sm text-black/60">Provisions and more</span></Link>
            <Link href="/printing" className="rounded-3xl border border-black/10 bg-white p-5 transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"><span aria-hidden="true" className="text-3xl">🖨️</span><span className="mt-3 block font-black">Print</span><span className="mt-1 block text-sm text-black/60">Upload and pay</span></Link>
          </div>
        )}

        <p className="mt-6 text-sm text-black/55">Printing has its own checkout: <Link href="/printing" className="font-bold text-black underline underline-offset-4">go to Printing</Link>.</p>
      </div>
    </main>
  );
}
