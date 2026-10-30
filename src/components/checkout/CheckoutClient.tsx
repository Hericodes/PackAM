"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeliveryLocation, hasPin } from "./LocationSelector";
import { CheckoutLocationStep } from "./CheckoutLocationStep";
import { Icon } from "../ui/Icon";
import { useCartExperience } from "../cart/CartExperience";
import { productImageDeliveryUrl } from "../../lib/cloudinary-url";
import { productGlyph } from "../../lib/products/category-display";


type CheckoutItem = {
  id: string;
  quantity: number;
  name: string;
  imageUrl: string | null;
  category: string;
  /** Server price for one unit (a plate: base + soup + extras). */
  unitPrice: number;
  /** A built plate's contents, e.g. "Amala + Ewedu + Meat ×2". */
  plate: string | null;
  /** The chosen options of a product with variants, e.g. "Colour: Black · Size: XL". */
  options?: string | null;
  /** Why this line can't be paid for right now. */
  problem: string | null;
};

type Revised = { subtotal: number; deliveryFee: number; total: number; reviewedTotal: number; lines: Array<{ cartItemId: string; name: string; quantity: number; unitPrice: number; total: number }> };

type CheckoutClientProps = {
  items: CheckoutItem[];
  deliveryFee: number;
  /** The student's own most recent delivery location, offered as "Use my last location". */
  lastLocation: DeliveryLocation | null;
  /** Display name of the provider new checkouts use, e.g. "Paystack". */
  providerName?: string;
  /** Food orders: the shop everything comes from. */
  shopName?: string | null;
  /** What stops this cart being paid for, from the server. */
  problems?: string[];
};

const money = (amount: number) => `₦${amount.toLocaleString()}`;

export function CheckoutClient({ items: initialItems, deliveryFee, lastLocation, providerName = "our payment partner", shopName = null, problems = [] }: CheckoutClientProps) {
  const router = useRouter();
  const { setSummary } = useCartExperience();
  // The server's revised breakdown when prices changed; payment waits for the student to confirm it.
  const [revised, setRevised] = useState<Revised | null>(null);
  const [items, setItems] = useState(initialItems);
  // Nothing is preselected: every checkout starts with the three location options.
  const [selectedLocation, setSelectedLocation] = useState<DeliveryLocation | null>(null);
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const currentDeliveryFee = items.length ? deliveryFee : 0;
  const total = subtotal + currentDeliveryFee;

  // A refresh (after a price change or an unavailable item) brings new server prices: show them.
  const [syncedItems, setSyncedItems] = useState(initialItems);
  if (syncedItems !== initialItems) {
    setSyncedItems(initialItems);
    setItems(initialItems);
  }

  // If the browser restores this page from its back/forward cache after payment, unfreeze the button.
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => { if (event.persisted) setPaymentBusy(false); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

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

  async function handlePayment(confirmedTotal?: number) {
    setError("");
    setMessage("");
    if (!items.length) return;
    if (!selectedLocation) {
      setError("Choose a delivery location to continue.");
      // Take the student straight to the step that needs attention.
      const section = document.getElementById("checkout-delivery");
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      section?.focus({ preventScroll: true });
      return;
    }
    if (busyItem || paymentBusy) return;
    setPaymentBusy(true);
    try {
      // The key covers the exact cart, so a changed cart can never reuse an attempt for an older amount.
      const cartFingerprint = items.map((item) => `${item.id}x${item.quantity}`).sort().join(",");
      const storageKey = `packam-payment-attempt:${selectedLocation.id}:${deliveryInstructions.trim()}:${cartFingerprint}:${confirmedTotal ?? total}`;
      let idempotencyKey = window.sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        window.sessionStorage.setItem(storageKey, idempotencyKey);
      }
      const response = await fetch("/api/payments/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        // The total the student is looking at. The server compares it with its own and never charges a different one silently.
        body: JSON.stringify({ deliveryLocationId: selectedLocation.id, deliveryInstructions, reviewedTotal: confirmedTotal ?? total }),
      });
      const data = await response.json();
      if (response.status === 409 && data.code === "PRICE_CHANGED" && data.revised) {
        window.sessionStorage.removeItem(storageKey);
        setRevised(data.revised as Revised);
        setPaymentBusy(false);
        return;
      }
      if (response.status === 409 && data.code === "CART_NOT_PAYABLE") {
        window.sessionStorage.removeItem(storageKey);
        router.refresh();
      }
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

  const paymentButton = (
    <button type="button" onClick={() => void handlePayment()} disabled={!items.length || paymentBusy || busyItem !== null || problems.length > 0 || revised !== null} aria-busy={paymentBusy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-black text-white transition hover:bg-[#262626] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-40">
      {paymentBusy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#feb80a] text-black"><Icon name="arrowRight" className="h-3 w-3" strokeWidth={3} /></span>}
      {paymentBusy ? `Opening ${providerName}…` : `Pay ${money(total)}`}
    </button>
  );

  const deliveringTo = selectedLocation ? (
    <div className="rounded-2xl bg-[#fff8df] p-3.5 text-sm">
      <p className="text-xs font-black uppercase tracking-wider text-[#875a00]">Delivering to</p>
      <p className="mt-1 break-words font-black">{selectedLocation.label}</p>
      <p className="break-words leading-5 text-black/70">{selectedLocation.address}</p>
      {deliveryInstructions.trim() && <p className="mt-1 break-words text-xs leading-5 text-black/60">“{deliveryInstructions.trim()}”</p>}
      <p className="mt-1.5 text-xs font-semibold text-black/55">{hasPin(selectedLocation) ? "GPS pin included for your runner" : "No GPS pin, the runner will use your written location"}</p>
    </div>
  ) : (
    <p className="rounded-2xl border border-dashed border-[#a15c00]/40 bg-[#fff3d6] p-3.5 text-sm font-semibold text-[#6b4700]">Choose a delivery location before you pay.</p>
  );

  const totals = (
    <dl className="space-y-2.5 text-sm">
      <div className="flex justify-between"><dt className="text-black/60">Items ({items.reduce((sum, item) => sum + item.quantity, 0)})</dt><dd className="font-bold">{money(subtotal)}</dd></div>
      <div className="flex justify-between"><dt className="text-black/60">Delivery</dt><dd className="font-bold">{money(currentDeliveryFee)}</dd></div>
      <div className="flex items-baseline justify-between border-t border-black/10 pt-3"><dt className="font-black">Total</dt><dd className="text-xl font-black">{money(total)}</dd></div>
    </dl>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
      <div className="space-y-5">
        <section id="checkout-delivery" tabIndex={-1} aria-labelledby="checkout-delivery-heading" className="pk-card scroll-mt-24 p-4 outline-none focus-visible:ring-2 focus-visible:ring-black sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-sm font-black text-[#feb80a]" aria-hidden="true">1</span>
            <div>
              <h2 id="checkout-delivery-heading" className="text-lg font-black">Delivery</h2>
              <p className="text-xs text-black/55">Where make your runner bring am?</p>
            </div>
          </div>
          <CheckoutLocationStep
            lastLocation={lastLocation}
            confirmed={selectedLocation}
            onConfirm={(location) => { setSelectedLocation(location); setDeliveryInstructions(location.instructions ?? ""); setError(""); }}
            onChange={() => setSelectedLocation(null)}
            onContinue={() => { const items = document.getElementById("checkout-items"); items?.scrollIntoView({ behavior: "smooth", block: "start" }); items?.focus({ preventScroll: true }); }}
          />
          {selectedLocation && <div className="mt-5">
            <label htmlFor="checkout-delivery-instructions" className="block text-sm font-black">Instructions for this order <span className="font-medium text-black/50">(optional)</span></label>
            <textarea id="checkout-delivery-instructions" value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value.slice(0, 500))} maxLength={500} rows={2} placeholder="e.g. Call me when you reach the hostel gate" aria-describedby="checkout-delivery-instructions-count" className="mt-2 min-h-20 w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-base outline-none transition placeholder:text-black/45 focus:border-black focus:shadow-[0_0_0_3px_rgba(254,184,10,0.45)]" />
            <p id="checkout-delivery-instructions-count" className="mt-1 text-right text-xs text-black/50">{deliveryInstructions.length}/500</p>
          </div>}
        </section>

        <section id="checkout-items" tabIndex={-1} aria-labelledby="checkout-items-heading" className="pk-card scroll-mt-24 p-4 outline-none sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-sm font-black text-[#feb80a]" aria-hidden="true">2</span>
              <div>
                <h2 id="checkout-items-heading" className="text-lg font-black">{shopName ? "Your food" : "Your items"}</h2>
                {shopName && <p className="text-xs text-black/55">From {shopName}</p>}
              </div>
            </div>
            <p className="text-xs font-semibold text-black/55">{items.length} {items.length === 1 ? "product" : "products"}</p>
          </div>
          {problems.length > 0 && (
            <div role="alert" className="mt-3 rounded-2xl border border-[#c92d24]/20 bg-[#ffe9e7] p-3.5 text-sm text-[#a3241c]">
              <p className="font-black">This order can’t be paid for yet</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
              <p className="mt-1.5 text-xs text-black/60">Remove the items marked below{shopName ? `, or come back when ${shopName} is open` : ""}. Nothing has been charged.</p>
            </div>
          )}
          {items.length === 0 ? (
            <div className="mt-4 rounded-2xl bg-[#fff8df] p-5 text-sm text-black/70">
              You never pick anything o 😂 Your cart dey do fasting. <Link className="font-black text-black underline" href="/search">Find something</Link>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-black/5">
              {items.map((item) => (
                <article key={item.id} className="flex min-w-0 gap-3 py-4 first:pt-3 last:pb-1 sm:gap-4">
                  <div className="pk-media pk-media-cream relative h-16 w-16 shrink-0 overflow-hidden rounded-xl sm:h-[72px] sm:w-[72px]">
                    {item.imageUrl ? <Image src={productImageDeliveryUrl(item.imageUrl)} alt="" fill sizes="72px" className="object-cover" /> : <div className="flex h-full items-center justify-center text-2xl" aria-hidden="true">{shopName ? "🍲" : productGlyph(item.name, item.category)}</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-black sm:text-base">{item.plate ? "Plate" : item.name}</p>
                    {item.plate && <p className="mt-0.5 break-words text-sm leading-5 text-black/70">{item.plate}</p>}
                    {item.options && <p className="mt-0.5 break-words text-sm leading-5 text-black/70">{item.options}</p>}
                    {item.problem ? <p className="mt-0.5 text-sm font-semibold text-[#c92d24]">{item.problem}</p> : <p className="mt-0.5 text-sm text-black/55">{money(item.unitPrice)} each</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <div className="flex h-11 items-center rounded-full border border-black/10 bg-white" role="group" aria-label={`${item.name} quantity`}>
                        <button type="button" onClick={() => changeItem(item.id, item.quantity - 1)} disabled={busyItem !== null} aria-label={`Decrease ${item.name} quantity`} className="h-11 w-11 rounded-l-full text-lg font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-black disabled:opacity-40">−</button>
                        <span className="w-7 text-center text-sm font-black" aria-live="polite">{item.quantity}</span>
                        <button type="button" onClick={() => changeItem(item.id, item.quantity + 1)} disabled={busyItem !== null || item.quantity >= 99} aria-label={`Increase ${item.name} quantity`} className="h-11 w-11 rounded-r-full text-lg font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-black disabled:opacity-40">+</button>
                      </div>
                      <button type="button" onClick={() => changeItem(item.id, 0)} disabled={busyItem !== null} className="min-h-11 px-1 text-sm font-bold text-black/65 underline underline-offset-4 transition hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-40">Remove</button>
                    </div>
                  </div>
                  <p className="shrink-0 pt-0.5 text-right text-base font-black">{money(item.unitPrice * item.quantity)}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Mobile summary (the pay button lives in the sticky bar below). */}
        <section aria-label="Order summary" className="pk-card space-y-4 p-4 lg:hidden">
          {totals}
          {deliveringTo}
        </section>
      </div>

      <aside aria-label="Order summary" className="pk-card hidden space-y-4 p-5 lg:sticky lg:top-24 lg:block">
        <h2 className="text-lg font-black">Order summary</h2>
        {totals}
        {deliveringTo}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-xl bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">{message}</p>}
        {paymentButton}
        <p className="flex items-start gap-2 text-xs leading-5 text-black/55"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 text-[#16803c]" strokeWidth={2.6} /> You’ll finish paying securely on {providerName}. The total above is what you’ll be charged.</p>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-[#fffdf7]/95 pk-safe-x pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <div className="min-w-0 shrink-0" aria-live="polite"><p className="text-xs font-bold text-black/60">Total</p><p className="text-lg font-black leading-6">{money(total)}</p></div>
          <div className="flex-1">{paymentButton}</div>
        </div>
        {error && <p role="alert" className="mx-auto mt-2 max-w-3xl text-sm font-semibold text-red-700">{error}</p>}
        {message && <p role="status" className="mx-auto mt-2 max-w-3xl text-sm font-semibold text-green-800">{message}</p>}
      </div>

      {revised && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div role="alertdialog" aria-modal="true" aria-labelledby="revised-title" className="max-h-[90svh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
            <h2 id="revised-title" className="text-lg font-black">Prices changed</h2>
            <p className="mt-1 text-sm text-black/65">Something changed since you looked: your total is now <strong>{money(revised.total)}</strong>, not {money(revised.reviewedTotal)}. Nothing has been charged.</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              {revised.lines.map((line) => (
                <div key={line.cartItemId} className="flex justify-between gap-3"><dt className="min-w-0 truncate">{line.name} × {line.quantity}</dt><dd className="shrink-0 font-bold">{money(line.total)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-black/10 pt-2"><dt className="text-black/60">Delivery</dt><dd className="font-bold">{money(revised.deliveryFee)}</dd></div>
              <div className="flex items-baseline justify-between"><dt className="font-black">New total</dt><dd className="text-xl font-black">{money(revised.total)}</dd></div>
            </dl>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => { const confirmed = revised.total; const prices = new Map(revised.lines.map((line) => [line.cartItemId, line.unitPrice])); setItems((current) => current.map((item) => ({ ...item, unitPrice: prices.get(item.id) ?? item.unitPrice }))); setRevised(null); void handlePayment(confirmed); }} className="pk-btn pk-btn-primary pk-btn-lg">Pay the new total · {money(revised.total)}</button>
              <button type="button" onClick={() => { const prices = new Map(revised.lines.map((line) => [line.cartItemId, line.unitPrice])); setItems((current) => current.map((item) => ({ ...item, unitPrice: prices.get(item.id) ?? item.unitPrice }))); setRevised(null); router.refresh(); }} className="pk-btn pk-btn-secondary">Review my order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
