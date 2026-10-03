"use client";

import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import { DeliveryLocation, LocationSelector } from "./LocationSelector";
import { useCartExperience } from "../cart/CartExperience";

type CheckoutItem = {
  id: string;
  quantity: number;
  product: { id: string; name: string; imageUrl: string | null; customerPrice: number; category: string };
};

type CheckoutClientProps = {
  items: CheckoutItem[];
  deliveryFee: number;
  locations: DeliveryLocation[];
};

const money = (amount: number) => `₦${amount.toLocaleString()}`;

export function CheckoutClient({ items: initialItems, deliveryFee, locations }: CheckoutClientProps) {
  const { setSummary } = useCartExperience();
  const [items, setItems] = useState(initialItems);
  const [selectedLocation, setSelectedLocation] = useState<DeliveryLocation | null>(locations[0] ?? null);
  const [deliveryInstructions, setDeliveryInstructions] = useState(locations[0]?.instructions ?? "");
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const subtotal = items.reduce((sum, item) => sum + item.product.customerPrice * item.quantity, 0);
  const currentDeliveryFee = items.length ? deliveryFee : 0;
  const total = subtotal + currentDeliveryFee;

  async function changeItem(itemId: string, quantity: number) {
    if (busyItem) return;
    const previousItems = items;
    const optimisticItems = quantity < 1
      ? items.filter((item) => item.id !== itemId)
      : items.map((item) => item.id === itemId ? { ...item, quantity } : item);
    setBusyItem(itemId);
    setError("");
    setMessage("");
    setItems(optimisticItems);

    try {
      const removing = quantity < 1;
      const response = await fetch("/api/cart", {
        method: removing ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(removing ? { itemId } : { itemId, quantity }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update your cart.");
      if (data.summary) setSummary(data.summary);
    } catch (err) {
      setItems(previousItems);
      setError(err instanceof Error ? err.message : "Unable to update your cart. Try again.");
    } finally {
      setBusyItem(null);
    }
  }

  async function handlePayment() {
    setError("");
    setMessage("");
    if (!items.length) return;
    if (!selectedLocation) {
      setError("Choose a delivery location to continue.");
      return;
    }
    if (busyItem || paymentBusy) return;
    setPaymentBusy(true);
    try {
      const storageKey = `packam-payment-attempt:${selectedLocation.id}:${deliveryInstructions.trim()}`;
      let idempotencyKey = window.sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        window.sessionStorage.setItem(storageKey, idempotencyKey);
      }
      const response = await fetch("/api/payments/opay/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ deliveryLocationId: selectedLocation.id, deliveryInstructions }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.cashierUrl !== "string") {
        throw new Error(data.error || "We couldn’t start your payment. Please try again.");
      }
      window.sessionStorage.removeItem(storageKey);
      window.location.assign(data.cashierUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn’t start your payment. Please try again.");
      setPaymentBusy(false);
    }
  }

  const paymentButton = <button type="button" onClick={handlePayment} disabled={!items.length || paymentBusy || busyItem !== null} className="flex min-h-12 w-full items-center justify-center rounded-full bg-black px-5 text-sm font-black text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-40">{paymentBusy ? "Opening OPay…" : `Pay ${money(total)}`}</button>;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:gap-6">
      <div className="space-y-5">
        <LocationSelector locations={locations} selectedLocation={selectedLocation} onSelect={(location) => { setSelectedLocation(location); setDeliveryInstructions(location.instructions ?? ""); }} />
        <label className="block rounded-[1.5rem] border border-black/5 bg-white p-4 text-sm font-bold sm:p-5">Delivery instructions <span className="font-normal text-black/45">(optional)</span><textarea value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value.slice(0, 500))} maxLength={500} rows={2} placeholder="Call me when you arrive" className="mt-2 w-full rounded-xl border border-black/10 bg-[#fffdf7] px-3 py-3 font-normal outline-none focus:border-black/30" /></label>
        <section className="rounded-[1.5rem] border border-black/5 bg-white p-4 lg:hidden">
          <div className="flex justify-between text-sm"><span className="text-black/55">Subtotal</span><span className="font-bold">{money(subtotal)}</span></div>
          <div className="mt-2 flex justify-between text-sm"><span className="text-black/55">Delivery</span><span className="font-bold">{money(currentDeliveryFee)}</span></div>
        </section>
        <section className="rounded-[1.5rem] border border-black/5 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-black">Your order</h2>
          {items.length === 0 ? (
            <div className="mt-4 rounded-2xl bg-[#f7f5ee] p-5 text-sm text-black/60">
              Your cart is empty. <Link className="font-black text-black underline" href="/search">Find something</Link>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-black/5">
              {items.map((item) => (
                <article key={item.id} className="flex gap-3 py-4 first:pt-2 last:pb-1 sm:gap-4">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#f7f5ee] sm:h-[72px] sm:w-[72px]">
                    {item.product.imageUrl ? <Image src={item.product.imageUrl} alt={item.product.name} fill className="object-cover" /> : <div className="flex h-full items-center justify-center text-2xl">📦</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-black">{item.product.name}</p>
                    <p className="mt-0.5 text-sm text-black/50">{money(item.product.customerPrice)} each</p>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex h-9 items-center rounded-full border border-black/10 bg-[#fffdf7]">
                        <button type="button" onClick={() => changeItem(item.id, item.quantity - 1)} disabled={busyItem !== null} aria-label={`Decrease ${item.product.name} quantity`} className="h-9 w-9 rounded-l-full text-lg font-black hover:bg-black/5 disabled:opacity-40">−</button>
                        <span className="w-7 text-center text-sm font-black">{item.quantity}</span>
                        <button type="button" onClick={() => changeItem(item.id, item.quantity + 1)} disabled={busyItem !== null || item.quantity >= 99} aria-label={`Increase ${item.product.name} quantity`} className="h-9 w-9 rounded-r-full text-lg font-black hover:bg-black/5 disabled:opacity-40">+</button>
                      </div>
                      <button type="button" onClick={() => changeItem(item.id, 0)} disabled={busyItem !== null} className="text-xs font-bold text-black/45 underline underline-offset-4 hover:text-red-600 disabled:opacity-40">Remove</button>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-black sm:text-base">{money(item.product.customerPrice * item.quantity)}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <aside className="hidden h-fit rounded-[1.5rem] border border-black/5 bg-white p-5 lg:sticky lg:top-24 lg:block">
        <h2 className="text-lg font-black">Total</h2>
        <div className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-black/55">Subtotal</span><span className="font-bold">{money(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-black/55">Delivery</span><span className="font-bold">{money(currentDeliveryFee)}</span></div>
          <div className="flex justify-between border-t border-black/5 pt-4 text-base font-black"><span>Total</span><span>{money(total)}</span></div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
        {message && <p role="status" className="mt-4 rounded-xl bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">{message}</p>}
        <div className="mt-5">{paymentButton}</div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-[#fffdf7] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <div className="min-w-0 shrink-0"><p className="text-[11px] font-bold text-black/50">Total</p><p className="text-lg font-black">{money(total)}</p></div>
          <div className="flex-1">{paymentButton}</div>
        </div>
        {error && <p role="alert" className="mx-auto mt-2 max-w-3xl text-xs font-semibold text-red-700">{error}</p>}
        {message && <p role="status" className="mx-auto mt-2 max-w-3xl text-xs font-semibold text-green-800">{message}</p>}
      </div>
    </div>
  );
}






