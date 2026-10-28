"use client";

import Image from "next/image";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductImageUpload } from "../../products/ProductImageUpload";
import { productImageDeliveryUrl } from "../../../lib/cloudinary-url";
import { FOOD_ROLES, ROLE_LABELS } from "../../../lib/food/admin-input";
import type { FoodRole } from "../../../lib/food/plate";
import { parseNairaInput } from "../../../lib/products/product-form";
import { Icon } from "../../ui/Icon";

export type AdminMenuItem = { id: string; name: string; role: FoodRole; price: number; section: string | null; description: string | null; imageUrl: string | null; maxPerPlate: number | null; available: boolean };

const ROLE_HELP: Record<FoodRole, string> = {
  MEAL: "Sold as one item at a fixed price.",
  BASE: "Students build a plate on it (one per plate).",
  SOUP: "Optional, one per plate.",
  EXTRA: "Priced individually, added to a plate.",
};
const label = "mb-1.5 block text-sm font-black";

function ItemForm({ shopId, item, sections, onDone }: { shopId: string; item?: AdminMenuItem; sections: string[]; onDone: () => void }) {
  const router = useRouter();
  const [role, setRole] = useState<FoodRole | "">(item?.role ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [section, setSection] = useState(item?.section ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [maxPerPlate, setMaxPerPlate] = useState(item?.maxPerPlate ? String(item.maxPerPlate) : "");
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? "");
  const [available, setAvailable] = useState(item?.available ?? false);
  const [imageBusy, setImageBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const amount = parseNairaInput(price);
    if (!item && !role) return setError("Choose what this item is.");
    if (!name.trim()) return setError("Enter the item’s name.");
    if (typeof amount !== "number" || amount < 1) return setError("Set a price in whole naira, at least ₦1.");
    sending.current = true; setBusy(true); setError("");
    try {
      const body = {
        ...(item ? {} : { role }), name: name.trim(), price: amount, section: section.trim(), description: description.trim(), imageUrl, available,
        ...((item?.role ?? role) === "EXTRA" ? { maxPerPlate: maxPerPlate ? Number(maxPerPlate) : null } : {}),
      };
      const response = await fetch(item ? `/api/admin/food/items/${item.id}` : `/api/admin/food/shops/${shopId}/items`, { method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The item couldn’t be saved.");
      router.refresh();
      onDone();
    } catch (cause) {
      setError(cause instanceof TypeError ? "No connection. Nothing was changed — try again." : cause instanceof Error ? cause.message : "The item couldn’t be saved.");
    } finally {
      sending.current = false; setBusy(false);
    }
  }

  const effectiveRole = item?.role ?? role;
  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {!item && (
        <fieldset>
          <legend className={label}>What is it?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FOOD_ROLES.map((value) => (
              <label key={value} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${role === value ? "border-black bg-white" : "border-black/10 bg-white/60"}`}>
                <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} className="mt-1 accent-black" />
                <span><span className="block text-sm font-black">{ROLE_LABELS[value]}</span><span className="block text-xs text-black/55">{ROLE_HELP[value]}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
        <div><label htmlFor={`item-name-${item?.id ?? "new"}`} className={label}>Name</label><input id={`item-name-${item?.id ?? "new"}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="pk-input" /></div>
        <div>
          <label htmlFor={`item-price-${item?.id ?? "new"}`} className={label}>Price</label>
          <div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-black text-black/55" aria-hidden="true">₦</span><input id={`item-price-${item?.id ?? "new"}`} value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" className="pk-input pl-9" /></div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`item-section-${item?.id ?? "new"}`} className={label}>Menu section <span className="font-medium text-black/45">Optional</span></label>
          <input id={`item-section-${item?.id ?? "new"}`} value={section} onChange={(event) => setSection(event.target.value)} list="food-sections" maxLength={120} placeholder="e.g. Rice and meals" className="pk-input" />
        </div>
        {effectiveRole === "EXTRA" && (
          <div>
            <label htmlFor={`item-max-${item?.id ?? "new"}`} className={label}>Most per plate</label>
            <select id={`item-max-${item?.id ?? "new"}`} value={maxPerPlate} onChange={(event) => setMaxPerPlate(event.target.value)} className="pk-input">
              <option value="">5 (the limit)</option>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
      </div>
      <datalist id="food-sections">{sections.map((value) => <option key={value} value={value} />)}</datalist>
      <div><label htmlFor={`item-description-${item?.id ?? "new"}`} className={label}>Description <span className="font-medium text-black/45">Optional</span></label><textarea id={`item-description-${item?.id ?? "new"}`} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} className="pk-input resize-y py-3" /></div>
      <div><p className={label}>Photo <span className="font-medium text-black/45">Optional</span></p><ProductImageUpload value={imageUrl} onChange={setImageUrl} onBusyChange={setImageBusy} disabled={busy} /></div>
      <label className="flex items-center gap-2.5 text-sm font-bold"><input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} className="h-5 w-5 accent-black" /> Available to order</label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || imageBusy} className="pk-btn pk-btn-primary">{busy ? "Saving…" : imageBusy ? "Waiting for the photo…" : item ? "Save item" : "Add item"}</button>
        <button type="button" onClick={onDone} disabled={busy} className="pk-btn pk-btn-secondary">Cancel</button>
      </div>
    </form>
  );
}

export function FoodMenuManager({ shopId, items }: { shopId: string; items: AdminMenuItem[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const sections = [...new Set(items.map((item) => item.section).filter((value): value is string => Boolean(value)))];

  async function toggle(item: AdminMenuItem) {
    if (toggling) return;
    setToggling(item.id); setError("");
    try {
      const response = await fetch(`/api/admin/food/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ available: !item.available }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Couldn’t change availability.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t change availability.");
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {FOOD_ROLES.map((role) => {
        const group = items.filter((item) => item.role === role);
        if (!group.length) return null;
        return (
          <section key={role} aria-labelledby={`role-${role}`}>
            <h3 id={`role-${role}`} className="text-xs font-black uppercase tracking-wider text-black/50">{ROLE_LABELS[role]}s</h3>
            <ul className="mt-2 divide-y divide-black/5 overflow-hidden rounded-2xl border border-black/5 bg-white">
              {group.map((item) => (
                <li key={item.id} className={item.available ? "" : "bg-black/[0.02]"}>
                  {editing === item.id ? (
                    <div className="p-3"><ItemForm shopId={shopId} item={item} sections={sections} onDone={() => setEditing(null)} /></div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[#f7f5ee]">
                        {item.imageUrl ? <Image src={productImageDeliveryUrl(item.imageUrl)} alt="" fill sizes="48px" className="object-contain" /> : <span className="flex h-full items-center justify-center text-black/30"><Icon name="image" className="h-5 w-5" /></span>}
                      </div>
                      {/* The name keeps at least ~11rem; on a phone the status and buttons wrap below it. */}
                      <div className="min-w-[11rem] flex-1 basis-[11rem]">
                        <p className={`font-black ${item.available ? "" : "text-black/55"}`}>{item.name}</p>
                        <p className="text-xs text-black/55">₦{item.price.toLocaleString()}{item.section ? ` · ${item.section}` : ""}{role === "EXTRA" ? ` · up to ${item.maxPerPlate ?? 5} per plate` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-black ${item.available ? "bg-[#e9f8ee] text-[#16803c]" : "bg-black/6 text-black/60"}`}>{item.available ? "Available" : "Hidden"}</span>
                        <button type="button" onClick={() => void toggle(item)} disabled={toggling !== null} className="pk-btn pk-btn-secondary pk-btn-sm">{toggling === item.id ? "Saving…" : item.available ? "Hide" : "Make available"}</button>
                        <button type="button" onClick={() => { setAdding(false); setEditing(item.id); }} className="pk-btn pk-btn-ghost pk-btn-sm">Edit</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!items.length && <p className="rounded-2xl border border-dashed border-black/15 bg-white p-5 text-sm text-black/60">No menu items yet. Add the shop’s ready-made meals, or the bases, soups and extras students build plates from.</p>}
      {adding ? <ItemForm shopId={shopId} sections={sections} onDone={() => setAdding(false)} /> : <button type="button" onClick={() => { setEditing(null); setAdding(true); }} className="pk-btn pk-btn-primary">+ Add menu item</button>}
    </div>
  );
}
