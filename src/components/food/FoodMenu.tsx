"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useCartExperience } from "../cart/CartExperience";
import { CartConflictDialog } from "../cart/CartConflictDialog";
import { productImageDeliveryUrl } from "../../lib/cloudinary-url";
import { BASE_GROUPS, EXTRA_GROUPS, GROUP_LABELS, MAX_BASE_QUANTITY, MAX_DISTINCT_BASES, extraLimit, foodPriceLabel, hasExtraLimit, portionUnit, priceLine, soupRule, type FoodGroup, type LineRequest } from "../../lib/food/plate";
import type { PublicMenuItem } from "../../lib/food/shops";

type Shop = { id: string; name: string; description: string | null; imageUrl: string | null; location: string | null; isOpen: boolean };

const naira = (amount: number) => `₦${amount.toLocaleString()}`;

function Stepper({ value, min, max, onChange, label, disabled, highlight = false }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string; disabled?: boolean; highlight?: boolean }) {
  const press = "h-10 w-10 text-lg font-black transition duration-150 hover:bg-black/5 disabled:opacity-30 motion-safe:active:scale-90";
  return (
    <div className={`flex h-10 shrink-0 items-center rounded-full border transition-colors duration-200 ${highlight ? "border-[#feb80a] bg-white shadow-[0_0_0_3px_rgba(254,184,10,0.25)]" : "border-black/10 bg-white"}`} role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label={`Fewer: ${label}`} className={`${press} rounded-l-full`}>−</button>
      <span key={value} className="pk-anim-pop w-7 text-center text-sm font-black tabular-nums" aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label={`More: ${label}`} className={`${press} rounded-r-full`}>+</button>
    </div>
  );
}

/** A numbered step heading that turns into a green tick once the step is done. */
function StepTitle({ number, done, children }: { number: number; done: boolean; children: ReactNode }) {
  return (
    <legend className="flex items-center gap-2 text-base font-black">
      <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black transition-colors duration-300 ${done ? "bg-[#16803c] text-white" : "bg-black text-white"}`}>
        {done ? <span key="done" className="pk-anim-pop">✓</span> : number}
      </span>
      <span>{children}</span>
    </legend>
  );
}

/**
 * A plate item in the checklist. Tapping it ticks it (one spoon, or one wrap of swallow); the stepper then sets how
 * many, and taking it down to 0 unticks it. The tick and the count pop; the card lifts on hover and presses on tap.
 */
function PortionCard({ item, quantity, disabled, note, onChange }: { item: PublicMenuItem; quantity: number; disabled: boolean; note?: string | null; onChange: (quantity: number) => void }) {
  const selected = quantity > 0;
  const unit = portionUnit(item.group);
  return (
    <div className={`flex items-center gap-2 rounded-2xl border p-2.5 transition duration-200 ${
      disabled && !selected ? "border-black/10 bg-white/60 opacity-60"
        : selected ? "border-[#feb80a] bg-[#fffbea] shadow-[0_0_0_2px_#feb80a,0_14px_30px_-18px_rgba(135,90,0,0.55)]"
          : "border-black/10 bg-white shadow-[0_1px_2px_rgba(8,8,8,0.04)] hover:border-black/25 hover:shadow-[0_12px_26px_-18px_rgba(135,90,0,0.5)] motion-safe:hover:-translate-y-0.5"
    }`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`${item.name}, ${naira(item.price)} per ${unit}`}
        disabled={disabled && !selected}
        onClick={() => onChange(selected ? 0 : 1)}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl text-left disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black motion-safe:active:scale-[0.98]"
      >
        <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors duration-200 ${selected ? "border-black bg-black text-[#feb80a]" : "border-black/25 bg-white"}`}>
          {selected && <span className="pk-anim-pop text-xs font-black">✓</span>}
        </span>
        <Thumb item={item} size="h-12 w-12" />
        <span className="min-w-0 flex-1">
          <span className="block font-black leading-5">{item.name}</span>
          <span className="block text-xs text-black/55">{naira(item.price)} per {unit}</span>
          {selected
            ? <span key={quantity} className="pk-anim-pop mt-0.5 inline-block text-xs font-black text-black">{quantity} {portionUnit(item.group, quantity)} = {naira(item.price * quantity)}</span>
            : note ? <span className="mt-0.5 block text-[0.6875rem] font-semibold text-[#a15c00]">{note}</span>
              : item.group === "SWALLOW" ? <span className="mt-1 inline-flex rounded-full bg-[#e9f8ee] px-2 py-0.5 text-[0.6875rem] font-black text-[#16803c]">+ free soup</span> : null}
        </span>
      </button>
      {selected && <Stepper value={quantity} min={0} max={MAX_BASE_QUANTITY} onChange={onChange} label={`${portionUnit(item.group, 2)} of ${item.name}`} disabled={disabled && quantity === 0} highlight />}
    </div>
  );
}

/**
 * A tappable choice (a plate or a soup): a radio inside a card. Selected: yellow outline, warm fill and a tick that
 * pops in. Lifts a little on hover, presses in on tap; still for anyone who asks for reduced motion.
 */
function ChoiceCard({ name, checked, disabled, onSelect, compact = false, children }: { name: string; checked: boolean; disabled?: boolean; onSelect: () => void; compact?: boolean; children: ReactNode }) {
  return (
    <label className={`relative flex items-center gap-3 rounded-2xl border transition duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-black ${compact ? "min-h-12 p-2.5 text-sm" : "min-h-16 p-2.5"} ${
      disabled ? "cursor-not-allowed border-black/10 bg-white/60 opacity-60"
        : checked ? "cursor-pointer border-[#feb80a] bg-[#fffbea] shadow-[0_0_0_2px_#feb80a,0_14px_30px_-18px_rgba(135,90,0,0.55)]"
          : "cursor-pointer border-black/10 bg-white shadow-[0_1px_2px_rgba(8,8,8,0.04)] hover:border-black/25 hover:shadow-[0_12px_26px_-18px_rgba(135,90,0,0.5)] motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98]"
    }`}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} disabled={disabled} className="sr-only" />
      {children}
      {checked && (
        <span aria-hidden="true" className={`absolute right-2.5 ${compact ? "top-1/2 -translate-y-1/2" : "top-2.5"}`}>
          <span className="pk-anim-pop flex h-5 w-5 items-center justify-center rounded-full bg-black text-[0.6875rem] font-black text-[#feb80a]">✓</span>
        </span>
      )}
    </label>
  );
}

function Thumb({ item, size = "h-16 w-16" }: { item: PublicMenuItem; size?: string }) {
  return (
    <div className={`pk-media pk-media-amber relative ${size} shrink-0 overflow-hidden rounded-2xl`}>
      {item.imageUrl ? <Image src={productImageDeliveryUrl(item.imageUrl)} alt="" fill sizes="64px" className="object-cover" /> : <span className="flex h-full items-center justify-center text-2xl" aria-hidden="true">🍲</span>}
    </div>
  );
}

/** Plate tabs: Swallow, Rice, Others, then "More" for bases made before groups existed. */
type BaseTab = FoodGroup | "MORE";
type PlateTab = BaseTab | "ALL";
const BASE_TAB_HINT: Partial<Record<BaseTab, string>> = { SWALLOW: "Comes with a free soup", RICE: "No soup needed", OTHER: "No soup needed" };
const EXTRA_SECTIONS: Array<{ key: FoodGroup | "MORE"; title: string; hint: string }> = [
  { key: "PROTEIN", title: GROUP_LABELS.PROTEIN, hint: "Beef, chicken, fish, egg…" },
  { key: "SIDE", title: GROUP_LABELS.SIDE, hint: "Plantain, moi moi, salad…" },
  { key: "DRINK", title: GROUP_LABELS.DRINK, hint: "Something to wash it down" },
  { key: "MORE", title: "Extras", hint: "" },
];

/** Groups items by the admin's menu sections, keeping the admin's order. */
function bySection(items: PublicMenuItem[], fallback: string) {
  const groups = new Map<string, PublicMenuItem[]>();
  for (const item of items) groups.set(item.section?.trim() || fallback, [...(groups.get(item.section?.trim() || fallback) ?? []), item]);
  return [...groups];
}

/**
 * `delivery`: the cheapest delivery speed on sale and how many speeds there are (deliveryPriceSummary), or null when
 * none is on sale. The student picks the speed, and pays its fee, at checkout.
 */
export function FoodMenu({ shop, menu, delivery }: { shop: Shop; menu: PublicMenuItem[]; delivery: { fromFee: number; options: number } | null }) {
  const router = useRouter();
  const { setSummary } = useCartExperience();
  const meals = menu.filter((item) => item.role === "MEAL");
  const bases = menu.filter((item) => item.role === "BASE");
  const soups = menu.filter((item) => item.role === "SOUP");
  const extras = menu.filter((item) => item.role === "EXTRA");
  const [mode, setMode] = useState<"meals" | "plate">(meals.length ? "meals" : "plate");
  const [mealQuantity, setMealQuantity] = useState<Record<string, number>>({});
  // Spoons (or wraps) of each plate item ticked; 0 or absent means not on the plate.
  const [baseQuantity, setBaseQuantity] = useState<Record<string, number>>({});
  // The plate tabs that have something in them, in a fixed order.
  // The groups that have something in them, in a fixed order; "All" first shows every one of them.
  const baseGroups: BaseTab[] = [...BASE_GROUPS.filter((group) => bases.some((base) => base.group === group)), ...(bases.some((base) => !base.group) ? ["MORE" as const] : [])];
  const baseTabs: PlateTab[] = ["ALL", ...baseGroups];
  const [baseTab, setBaseTab] = useState<PlateTab>("ALL");
  const activeTab: PlateTab = baseTabs.includes(baseTab) ? baseTab : "ALL";
  const visibleGroups = activeTab === "ALL" ? baseGroups : [activeTab];
  const basesIn = (group: BaseTab) => bases.filter((item) => (group === "MORE" ? !item.group : item.group === group));
  const soupStepRef = useRef<HTMLFieldSetElement>(null);
  const [soupTouched, setSoupTouched] = useState(false);
  const [soupId, setSoupId] = useState<string>("");
  const [extraQuantity, setExtraQuantity] = useState<Record<string, number>>({});
  const [plates, setPlates] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ message: string; line: LineRequest; key: string } | null>(null);
  const sending = useRef(false);

  const chosenBases = useMemo(() => menu.filter((item) => item.role === "BASE" && (baseQuantity[item.id] ?? 0) > 0).map((item) => ({ productId: item.id, quantity: baseQuantity[item.id] })), [menu, baseQuantity]);
  const plateRequest = useMemo<LineRequest | null>(() => (chosenBases.length ? {
    kind: "PLATE", bases: chosenBases, soupId: soupId || null, quantity: plates,
    extras: Object.entries(extraQuantity).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity })),
  } : null), [chosenBases, soupId, plates, extraQuantity]);
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
      if (line.kind === "PLATE") { setBaseQuantity({}); setSoupId(""); setSoupTouched(false); setExtraQuantity({}); setPlates(1); }
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
  const selectedBases = bases.filter((item) => (baseQuantity[item.id] ?? 0) > 0);
  const base = selectedBases[0] ?? null;
  const selectedSwallow = selectedBases.filter((item) => item.group === "SWALLOW");
  const selectedNonSwallow = selectedBases.some((item) => item.group === "RICE" || item.group === "OTHER");
  // The plate's soup rule: any swallow needs one; only rice/others take none; items without a group keep it optional.
  const rule: "required" | "none" | "optional" | null = !base ? null : selectedSwallow.length ? "required" : selectedBases.every((item) => soupRule(item) === "none") ? "none" : "optional";
  const atItemLimit = selectedBases.length >= MAX_DISTINCT_BASES;
  /** Why an unticked plate item can't be added to this plate right now (null: it can). */
  const blockedReason = (item: PublicMenuItem) => {
    if ((baseQuantity[item.id] ?? 0) > 0) return null;
    if (item.group === "SWALLOW" && soups.length === 0) return "No soup today";
    if (item.group === "SWALLOW" && selectedNonSwallow) return "Swallow goes on its own plate";
    if ((item.group === "RICE" || item.group === "OTHER") && selectedSwallow.length) return "Not with swallow \u2014 add it as another plate";
    if (atItemLimit) return `Up to ${MAX_DISTINCT_BASES} different items per plate`;
    return null;
  };
  const extrasIn = (key: FoodGroup | "MORE") => extras.filter((extra) => (key === "MORE" ? !extra.group || !(EXTRA_GROUPS as readonly string[]).includes(extra.group) : extra.group === key));
  const proteins = extrasIn("PROTEIN");
  const hasProtein = proteins.some((extra) => (extraQuantity[extra.id] ?? 0) > 0);
  const showSoupStep = Boolean(base) && rule !== "none";
  const addOnStep = showSoupStep ? 3 : 2;
  const addOnCount = Object.values(extraQuantity).reduce((sum, quantity) => sum + quantity, 0);

  function setPortion(id: string, quantity: number) {
    const next = { ...baseQuantity, [id]: quantity };
    if (quantity <= 0) delete next[id];
    setBaseQuantity(next);
    const item = bases.find((candidate) => candidate.id === id);
    const nowSelected = bases.filter((candidate) => (next[candidate.id] ?? 0) > 0);
    // Only rice/others left: they take no soup, so drop one chosen for a swallow before.
    if (nowSelected.length && nowSelected.every((candidate) => soupRule(candidate) === "none")) { setSoupId(""); setSoupTouched(false); }
    // The first swallow ticked needs a soup next: bring that step into view if it's below the screen.
    if (item && item.group === "SWALLOW" && quantity === 1 && !soupId && !selectedSwallow.length) {
      window.setTimeout(() => {
        const step = soupStepRef.current;
        if (!step || step.getBoundingClientRect().top < window.innerHeight * 0.75) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        step.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }, 60);
    }
  }

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
            {delivery && <span>Delivery {delivery.options > 1 ? "from " : ""}{naira(delivery.fromFee)}</span>}
          </p>
          {shop.description && <p className="mt-1.5 text-sm leading-5 text-black/70">{shop.description}</p>}
        </div>
      </header>

      {closed && <p role="status" className="mt-3 rounded-2xl bg-[#fff3d6] px-4 py-3 text-sm font-semibold text-[#6b4700]">{shop.name} is closed right now. You can look at the menu, but orders open when the shop does.</p>}
      {added && <p role="status" className="pk-anim-rise mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#e9f8ee] px-4 py-3 text-sm font-semibold text-[#16803c]"><span>✓ {added}</span><Link href="/checkout" className="font-black text-black underline underline-offset-4">Go to checkout</Link></p>}
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
                    <li key={meal.id} className="pk-anim-rise flex gap-3 rounded-2xl border border-black/[0.11] bg-white p-2.5 shadow-[0_1px_2px_rgba(8,8,8,0.05),0_10px_24px_-16px_rgba(135,90,0,0.38)] transition duration-200 hover:border-black/20 hover:shadow-[0_2px_4px_rgba(8,8,8,0.05),0_18px_34px_-16px_rgba(135,90,0,0.5)] motion-safe:hover:-translate-y-0.5">
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
            <section className="mt-4 space-y-5" aria-label="Build your plate">
              <fieldset>
                <StepTitle number={1} done={Boolean(base)}>Choose your plate <span className="font-medium text-black/50">(tick one or more)</span></StepTitle>
                {baseTabs.length > 2 && (
                  <div role="tablist" aria-label="Plate type" className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1">
                    {baseTabs.map((tab) => (
                      <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setBaseTab(tab)} className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-black transition duration-200 motion-safe:active:scale-95 ${activeTab === tab ? "border-black bg-black text-white shadow-[0_6px_16px_-8px_rgba(8,8,8,0.6)]" : "border-black/10 bg-white text-black/70 hover:border-black/30 hover:text-black"}`}>
                        {tab === "ALL" ? "All" : tab === "MORE" ? "More" : GROUP_LABELS[tab]}
                        <span className={`ml-1.5 text-xs font-bold ${activeTab === tab ? "text-white/60" : "text-black/40"}`}>{tab === "ALL" ? bases.length : basesIn(tab).length}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div key={activeTab ?? "none"} className="pk-anim-rise mt-2 space-y-3">
                  {visibleGroups.map((group) => {
                    const items = basesIn(group);
                    const noSoupToday = group === "SWALLOW" && soups.length === 0;
                    return (
                      <div key={group}>
                        {(activeTab === "ALL" || BASE_TAB_HINT[group]) && (
                          <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 px-1">
                            {activeTab === "ALL" && <span className="text-xs font-black uppercase tracking-[0.08em] text-black/55">{group === "MORE" ? "More" : GROUP_LABELS[group]}</span>}
                            {BASE_TAB_HINT[group] && <span className={`text-xs font-semibold ${noSoupToday ? "text-[#a15c00]" : "text-black/50"}`}>{noSoupToday ? "No soup today, so swallow can’t be ordered right now" : BASE_TAB_HINT[group]}</span>}
                          </p>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2">
                          {items.map((item) => (
                            <PortionCard key={item.id} item={item} quantity={baseQuantity[item.id] ?? 0} disabled={closed || blockedReason(item) !== null} note={noSoupToday ? null : blockedReason(item)} onChange={(quantity) => setPortion(item.id, quantity)} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </fieldset>

              {showSoupStep && (
                <fieldset ref={soupStepRef} className="pk-anim-rise scroll-mt-24">
                  <StepTitle number={2} done={Boolean(soupId) || (rule === "optional" && soupTouched)}>
                    Choose your soup {rule === "required" ? <span className="ml-1 rounded-full bg-[#e9f8ee] px-2 py-0.5 align-middle text-[0.6875rem] font-black text-[#16803c]">Free</span> : <span className="font-medium text-black/50">(optional)</span>}
                  </StepTitle>
                  {soups.length === 0 ? (
                    <p className="mt-2 rounded-2xl bg-[#fff3d6] px-3 py-2.5 text-sm font-semibold text-[#6b4700]">No soup is available right now, so {selectedSwallow.map((item) => item.name).join(" and ") || "swallow"} can’t be ordered. Try a rice plate or a ready-made meal.</p>
                  ) : (
                    <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {[...(rule === "optional" ? [{ id: "", name: "No soup", price: 0 }] : []), ...soups].map((soup) => (
                        <ChoiceCard key={soup.id || "none"} name="soup" compact checked={soupId === soup.id && (soup.id !== "" || soupTouched)} disabled={closed} onSelect={() => { setSoupId(soup.id); setSoupTouched(true); }}>
                          <span className="min-w-0 flex-1 font-bold leading-5">{soup.name}</span>
                          {soup.id && <span className={`pr-7 text-xs font-black ${soup.price === 0 ? "text-[#16803c]" : ""}`}>{foodPriceLabel(soup.price)}</span>}
                        </ChoiceCard>
                      ))}
                    </div>
                  )}
                </fieldset>
              )}

              {extras.length > 0 && (
                <fieldset className={base ? "pk-anim-rise" : ""}>
                  <StepTitle number={addOnStep} done={addOnCount > 0}>Add protein &amp; more <span className="font-medium text-black/50">(optional)</span></StepTitle>
                  {base && proteins.length > 0 && !hasProtein && <p className="mt-1.5 text-xs font-semibold text-[#7a4a00]">Add some protein? Most plates go with beef, fish or egg.</p>}
                  <div className="mt-2.5 space-y-3">
                    {EXTRA_SECTIONS.map(({ key, title, hint }) => {
                      const rows = extrasIn(key);
                      if (!rows.length) return null;
                      return (
                        <div key={key}>
                          <p className="px-1 text-xs font-black uppercase tracking-[0.08em] text-black/55">{title}{hint && <span className="ml-1.5 font-semibold normal-case tracking-normal text-black/45">{hint}</span>}</p>
                          <ul className="mt-1.5 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_1px_2px_rgba(8,8,8,0.04)]">
                            {rows.map((extra) => {
                              const quantity = extraQuantity[extra.id] ?? 0;
                              return (
                                <li key={extra.id} className={`flex items-center gap-3 border-b border-black/5 px-3 py-2.5 transition-colors duration-200 last:border-0 ${quantity > 0 ? "bg-[#fffbea] shadow-[inset_3px_0_0_#feb80a]" : ""}`}>
                                  <span className="min-w-0 flex-1">
                                    <span className="block font-bold leading-5">{extra.name}</span>
                                    <span className="text-xs text-black/55">{naira(extra.price)} each{hasExtraLimit(extra) ? ` · max ${extraLimit(extra)}` : ""}{quantity > 0 && <span key={quantity} className="pk-anim-pop ml-1.5 inline-block font-black text-black">= {naira(extra.price * quantity)}</span>}</span>
                                  </span>
                                  <Stepper value={quantity} min={0} max={extraLimit(extra)} onChange={(value) => setExtraQuantity((current) => ({ ...current, [extra.id]: value }))} label={extra.name} disabled={closed} highlight={quantity > 0} />
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              <div className={`rounded-[22px] border bg-white p-4 transition-shadow duration-300 ${platePreview?.ok ? "border-black/15 shadow-[0_18px_40px_-24px_rgba(135,90,0,0.55)]" : "border-black/10"}`} aria-live="polite">
                {platePreview?.ok ? (
                  <dl className="space-y-1.5 text-sm">
                    <p className="text-xs font-black uppercase tracking-[0.08em] text-black/50">Your plate</p>
                    {platePreview.line.details.kind === "PLATE" && <>
                      {(platePreview.line.details.bases ?? [{ ...platePreview.line.details.base, quantity: 1, total: platePreview.line.details.base.price }]).map((item) => {
                        const group = bases.find((candidate) => candidate.id === item.id)?.group;
                        return <div key={item.id} className="flex justify-between gap-3"><dt>{item.name} <span className="text-black/50">· {item.quantity} {portionUnit(group, item.quantity)}</span></dt><dd className="font-bold">{naira(item.total)}</dd></div>;
                      })}
                      {platePreview.line.details.soup && <div className="flex justify-between gap-3"><dt>{platePreview.line.details.soup.name}</dt><dd className={`font-bold ${platePreview.line.details.soup.price === 0 ? "text-[#16803c]" : ""}`}>{foodPriceLabel(platePreview.line.details.soup.price)}</dd></div>}
                      {platePreview.line.details.extras.map((extra) => <div key={extra.id} className="flex justify-between gap-3"><dt>{extra.name}{extra.quantity > 1 ? ` × ${extra.quantity}` : ""}</dt><dd className="font-bold">{naira(extra.total)}</dd></div>)}
                    </>}
                    <div className="flex items-center justify-between border-t border-dashed border-black/15 pt-2.5">
                      <dt className="font-black">Plate {naira(platePreview.line.unitPrice)}{plates > 1 ? ` × ${plates}` : ""}</dt>
                      <dd key={platePreview.line.total} className="pk-anim-pop text-xl font-black">{naira(platePreview.line.total)}</dd>
                    </div>
                    <p className="text-xs text-black/55">{!delivery ? "+ delivery, shown at checkout." : delivery.options > 1 ? `Choose how fast you need it. Delivery starts from ${naira(delivery.fromFee)}.` : `+ ${naira(delivery.fromFee)} delivery, shown at checkout.`}</p>
                  </dl>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-black/60"><span aria-hidden="true">🍽️</span>{platePreview && !platePreview.ok ? platePreview.error : "Choose your plate to see the price."}</p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <Stepper value={plates} min={1} max={20} onChange={setPlates} label="Number of plates" disabled={closed} />
                  <button type="button" onClick={() => plateRequest && void add(plateRequest, "plate")} disabled={closed || busy !== null || !platePreview?.ok} aria-busy={busy === "plate"} className="pk-btn pk-btn-primary min-h-12 flex-1 transition duration-200 motion-safe:active:scale-[0.98]">
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
