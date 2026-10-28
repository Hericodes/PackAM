"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useCartExperience } from "../cart/CartExperience";
import { CartConflictDialog } from "../cart/CartConflictDialog";
import { productImageDeliveryUrl } from "../../lib/cloudinary-url";
import { extraLimit, priceLine, type LineRequest } from "../../lib/food/plate";
import type { PublicMenuItem } from "../../lib/food/shops";

type Shop = { id: string; name: string; description: string | null; imageUrl: string | null; location: string | null; isOpen: boolean };

const naira = (amount: number) => `₦${amount.toLocaleString()}`;

function Stepper({ value, min, max, onChange, label, disabled }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex h-10 items-center rounded-full border border-black/10 bg-white" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label={`Fewer: ${label}`} className="h-10 w-10 rounded-l-full text-lg font-black hover:bg-black/5 disabled:opacity-30">−</button>
      <span className="w-6 text-center text-sm font-black" aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label={`More: ${label}`} className="h-10 w-10 rounded-r-full text-lg font-black hover:bg-black/5 disabled:opacity-30">+</button>
    </div>
  );
}

function Thumb({ item, size = "h-16 w-16" }: { item: PublicMenuItem; size?: string }) {
  return (
    <div className={`pk-media pk-media-amber relative ${size} shrink-0 overflow-hidden rounded-2xl`}>
      {item.imageUrl ? <Image src={productImageDeliveryUrl(item.imageUrl)} alt="" fill sizes="64px" className="object-cover" /> : <span className="flex h-full items-center justify-center text-2xl" aria-hidden="true">🍲</span>}
    </div>
  );
}

/** Groups items by the admin's menu sections, keeping the admin's order. */
function bySection(items: PublicMenuItem[], fallback: string) {
  const groups = new Map<string, PublicMenuItem[]>();
  for (const item of items) groups.set(item.section?.trim() || fallback, [...(groups.get(item.section?.trim() || fallback) ?? []), item]);
  return [...groups];
}

export function FoodMenu({ shop, menu, deliveryFee }: { shop: Shop; menu: PublicMenuItem[]; deliveryFee: number }) {
  const router = useRouter();
  const { setSummary } = useCartExperience();
  const meals = menu.filter((item) => item.role === "MEAL");
  const bases = menu.filter((item) => item.role === "BASE");
  const soups = menu.filter((item) => item.role === "SOUP");
  const extras = menu.filter((item) => item.role === "EXTRA");
  const [mode, setMode] = useState<"meals" | "plate">(meals.length ? "meals" : "plate");
  const [mealQuantity, setMealQuantity] = useState<Record<string, number>>({});
  const [baseId, setBaseId] = useState<string>("");
  const [soupId, setSoupId] = useState<string>("");
  const [extraQuantity, setExtraQuantity] = useState<Record<string, number>>({});
  const [plates, setPlates] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ message: string; line: LineRequest; key: string } | null>(null);
  const sending = useRef(false);

  const plateRequest = useMemo<LineRequest | null>(() => (baseId ? {
    kind: "PLATE", baseId, soupId: soupId || null, quantity: plates,
    extras: Object.entries(extraQuantity).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity })),
  } : null), [baseId, soupId, plates, extraQuantity]);
  // For display only: the server prices the plate again when it is added, and again at payment.
  const platePreview = useMemo(() => (plateRequest ? priceLine(menu, plateRequest) : null), [menu, plateRequest]);

  async function add(line: LineRequest, key: string, clearCart = false) {
    if (sending.current) return;
    sending.current = true;
    setBusy(key); setError(""); setAdded(null);
    try {
      const response = await fetch("/api/food/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId: shop.id, line, ...(clearCart ? { clearCart: true } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { router.push(`/login?callbackUrl=${encodeURIComponent(`/food/${shop.id}`)}`); return; }
      if (response.status === 409 && data.code === "CART_CONTEXT") { setConflict({ message: data.error, line, key }); return; }
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t add that. Try again.");
      setConflict(null);
      if (data.summary) setSummary(data.summary);
      setAdded(`${data.added?.name ?? "Food"} added${data.cleared ? " (your old cart was cleared)" : ""}.`);
      if (line.kind === "PLATE") { setBaseId(""); setSoupId(""); setExtraQuantity({}); setPlates(1); }
      else setMealQuantity((current) => ({ ...current, [line.productId]: 1 }));
    } catch (cause) {
      setError(cause instanceof TypeError ? "No connection. Check your internet and try again." : cause instanceof Error ? cause.message : "We couldn’t add that. Try again.");
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  const closed = !shop.isOpen;
  const canBuild = bases.length > 0;

  return (
    <>
      <header className="mt-1 flex items-start gap-3">
        <div className="pk-media pk-media-amber relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl sm:h-20 sm:w-20">
          {shop.imageUrl ? <Image src={productImageDeliveryUrl(shop.imageUrl)} alt="" fill sizes="80px" priority className="object-cover" /> : <span className="flex h-full items-center justify-center text-3xl" aria-hidden="true">🍲</span>}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-black leading-tight tracking-tight sm:text-3xl">{shop.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-black/60 sm:text-sm">
            <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-black ${shop.isOpen ? "bg-[#e9f8ee] text-[#16803c]" : "bg-black/6 text-black/60"}`}>{shop.isOpen ? "Open" : "Closed"}</span>
            {shop.location && <span>{shop.location}</span>}
            <span>Delivery {naira(deliveryFee)}</span>
          </p>
          {shop.description && <p className="mt-1.5 text-sm leading-5 text-black/70">{shop.description}</p>}
        </div>
      </header>

      {closed && <p role="status" className="mt-3 rounded-2xl bg-[#fff3d6] px-4 py-3 text-sm font-semibold text-[#6b4700]">{shop.name} is closed right now. You can look at the menu, but orders open when the shop does.</p>}
      {added && <p role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#e9f8ee] px-4 py-3 text-sm font-semibold text-[#16803c]"><span>✓ {added}</span><Link href="/checkout" className="font-black text-black underline underline-offset-4">Go to checkout</Link></p>}
      {error && <p role="alert" className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      {menu.length === 0 ? (
        <div className="pk-empty mt-4 px-4 py-8">
          <h2 className="text-lg font-black">No menu yet</h2>
          <p className="pk-muted mt-1 text-sm">{shop.name} hasn’t added food here yet. Try another shop for now.</p>
          <Link href="/food" className="pk-btn pk-btn-secondary mt-4">See other shops</Link>
        </div>
      ) : (
        <>
          {meals.length > 0 && canBuild && (
            <div role="tablist" aria-label="How do you want to order?" className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-black/5 p-1">
              {([["meals", "Ready-made meals"], ["plate", "Build a plate"]] as const).map(([value, text]) => (
                <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={`min-h-10 rounded-full text-sm font-black transition ${mode === value ? "bg-black text-white" : "text-black/70"}`}>{text}</button>
              ))}
            </div>
          )}

          {mode === "meals" && meals.length > 0 && bySection(meals, "Meals").map(([section, items]) => (
            <section key={section} className="mt-4" aria-labelledby={`section-${section}`}>
              <h2 id={`section-${section}`} className="text-sm font-black uppercase tracking-wider text-black/50">{section}</h2>
              <ul className="mt-2 grid gap-2 lg:grid-cols-2">
                {items.map((meal) => {
                  const quantity = mealQuantity[meal.id] ?? 1;
                  return (
                    <li key={meal.id} className="flex gap-3 rounded-2xl border border-black/[0.07] bg-white p-2.5">
                      <Thumb item={meal} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="font-black leading-5">{meal.name}</p>
                        {meal.description && <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-black/60">{meal.description}</p>}
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
                          <p className="text-lg font-black">{naira(meal.price)}</p>
                          <div className="flex items-center gap-1.5">
                            <Stepper value={quantity} min={1} max={20} onChange={(value) => setMealQuantity((current) => ({ ...current, [meal.id]: value }))} label={`${meal.name} quantity`} disabled={closed} />
                            <button type="button" onClick={() => void add({ kind: "MEAL", productId: meal.id, quantity }, meal.id)} disabled={closed || busy !== null} aria-busy={busy === meal.id} className="pk-btn pk-btn-primary min-h-10 px-4">{busy === meal.id ? "Adding…" : "Add"}</button>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {mode === "plate" && canBuild && (
            <section className="mt-4 space-y-4" aria-label="Build your plate">
              <fieldset>
                <legend className="text-sm font-black">1. Choose your base</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {bases.map((base) => (
                    <label key={base.id} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border bg-white p-2.5 ${baseId === base.id ? "border-black ring-1 ring-black" : "border-black/10"}`}>
                      <input type="radio" name="base" value={base.id} checked={baseId === base.id} onChange={() => setBaseId(base.id)} disabled={closed} className="h-5 w-5 accent-black" />
                      <span className="min-w-0 flex-1"><span className="block font-black leading-5">{base.name}</span>{base.description && <span className="block truncate text-xs text-black/55">{base.description}</span>}</span>
                      <span className="text-sm font-black">{naira(base.price)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {soups.length > 0 && (
                <fieldset>
                  <legend className="text-sm font-black">2. Soup <span className="font-medium text-black/50">(optional)</span></legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {[{ id: "", name: "No soup", price: 0 }, ...soups].map((soup) => (
                      <label key={soup.id || "none"} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border bg-white p-2.5 ${soupId === soup.id ? "border-black ring-1 ring-black" : "border-black/10"}`}>
                        <input type="radio" name="soup" value={soup.id} checked={soupId === soup.id} onChange={() => setSoupId(soup.id)} disabled={closed} className="h-5 w-5 accent-black" />
                        <span className="flex-1 font-bold">{soup.name}</span>
                        {soup.id && <span className="text-sm font-black">{naira(soup.price)}</span>}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {extras.length > 0 && (
                <fieldset>
                  <legend className="text-sm font-black">{soups.length ? "3." : "2."} Extras <span className="font-medium text-black/50">(optional)</span></legend>
                  <ul className="mt-2 divide-y divide-black/5 rounded-2xl border border-black/10 bg-white">
                    {extras.map((extra) => (
                      <li key={extra.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1"><span className="block font-bold leading-5">{extra.name}</span><span className="text-xs text-black/55">{naira(extra.price)} each · up to {extraLimit(extra)}</span></span>
                        <Stepper value={extraQuantity[extra.id] ?? 0} min={0} max={extraLimit(extra)} onChange={(value) => setExtraQuantity((current) => ({ ...current, [extra.id]: value }))} label={extra.name} disabled={closed} />
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}

              <div className="rounded-2xl border border-black/10 bg-[#fffdf7] p-3.5" aria-live="polite">
                {platePreview?.ok ? (
                  <dl className="space-y-1 text-sm">
                    {platePreview.line.details.kind === "PLATE" && <>
                      <div className="flex justify-between"><dt>{platePreview.line.details.base.name}</dt><dd className="font-bold">{naira(platePreview.line.details.base.price)}</dd></div>
                      {platePreview.line.details.soup && <div className="flex justify-between"><dt>{platePreview.line.details.soup.name}</dt><dd className="font-bold">{naira(platePreview.line.details.soup.price)}</dd></div>}
                      {platePreview.line.details.extras.map((extra) => <div key={extra.id} className="flex justify-between"><dt>{extra.name}{extra.quantity > 1 ? ` × ${extra.quantity}` : ""}</dt><dd className="font-bold">{naira(extra.total)}</dd></div>)}
                    </>}
                    <div className="flex items-center justify-between border-t border-black/10 pt-2">
                      <dt className="font-black">Plate {naira(platePreview.line.unitPrice)}{plates > 1 ? ` × ${plates}` : ""}</dt>
                      <dd className="text-lg font-black">{naira(platePreview.line.total)}</dd>
                    </div>
                    <p className="text-xs text-black/55">+ {naira(deliveryFee)} delivery, shown at checkout.</p>
                  </dl>
                ) : (
                  <p className="text-sm text-black/60">{platePreview && !platePreview.ok ? platePreview.error : "Choose a base to see your plate’s price."}</p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <Stepper value={plates} min={1} max={20} onChange={setPlates} label="Number of plates" disabled={closed} />
                  <button type="button" onClick={() => plateRequest && void add(plateRequest, "plate")} disabled={closed || busy !== null || !platePreview?.ok} aria-busy={busy === "plate"} className="pk-btn pk-btn-primary min-h-11 flex-1">
                    {busy === "plate" ? "Adding…" : platePreview?.ok ? `Add plate · ${naira(platePreview.line.total)}` : "Add plate"}
                  </button>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {conflict && <CartConflictDialog message={conflict.message} busy={busy !== null} onClear={() => void add(conflict.line, conflict.key, true)} onClose={() => setConflict(null)} />}
    </>
  );
}
