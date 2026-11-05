"use client";

import Image from "next/image";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductImageUpload } from "../../products/ProductImageUpload";
import { productImageDeliveryUrl } from "../../../lib/cloudinary-url";
import { FOOD_ROLES, ROLE_LABELS, groupsForRole } from "../../../lib/food/admin-input";
import { GROUP_LABELS, foodPriceLabel, soupRule, type FoodGroup, type FoodRole } from "../../../lib/food/plate";
import { parseNairaInput } from "../../../lib/products/product-form";
import { Icon } from "../../ui/Icon";

export type AdminMenuItem = { id: string; name: string; role: FoodRole; group: FoodGroup | null; price: number; section: string | null; description: string | null; imageUrl: string | null; maxPerPlate: number | null; available: boolean };

const ROLE_HELP: Record<FoodRole, string> = {
  MEAL: "A fixed combo at one price, e.g. “Jollof rice, chicken & plantain”.",
  BASE: "What a plate is built on: swallow (amala, eba…), rice, or others (beans, spaghetti…).",
  SOUP: "Egusi, ewedu, efo… Swallow plates must pick one. Free unless you price it.",
  EXTRA: "Added on top of a plate: protein (beef, fish, egg), sides (plantain, moi moi) or drinks.",
};
const GROUP_HELP: Record<FoodGroup, string> = {
  SWALLOW: "Amala, eba, semo, fufu, pounded yam. Students must pick a soup.",
  RICE: "Jollof, fried, white rice. No soup step.",
  OTHER: "Beans, spaghetti, yam, porridge. No soup step.",
  PROTEIN: "Beef, chicken, fish, turkey, ponmo, egg.",
  SIDE: "Plantain, moi moi, salad, coleslaw.",
  DRINK: "Soft drinks, water, juice.",
};
const label = "mb-1.5 block text-sm font-black";

function ItemForm({ shopId, item, sections, onDone }: { shopId: string; item?: AdminMenuItem; sections: string[]; onDone: () => void }) {
  const router = useRouter();
  const [role, setRole] = useState<FoodRole | "">(item?.role ?? "");
  const [group, setGroup] = useState<FoodGroup | "">(item?.group ?? "");
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
    const itemRole = item?.role ?? role;
    // A soup left empty is free.
    const amount = itemRole === "SOUP" && !price.trim() ? 0 : parseNairaInput(price);
    if (!item && !role) return setError("Choose what this item is.");
    if (groupsForRole(itemRole || undefined).length && !group) return setError(itemRole === "BASE" ? "Choose the plate group: Swallow, Rice or Others." : "Choose the add-on group: Protein, Sides or Drinks.");
    if (!name.trim()) return setError("Enter the item’s name.");
    if (typeof amount !== "number" || amount < (itemRole === "SOUP" ? 0 : 1)) return setError(itemRole === "SOUP" ? "Set the soup’s price, or leave it at 0 for free." : "Set a price in whole naira, at least ₦1.");
    sending.current = true; setBusy(true); setError("");
    try {
      const body = {
        ...(item ? {} : { role }), ...(group && group !== item?.group ? { group } : {}), name: name.trim(), price: amount, section: section.trim(), description: description.trim(), imageUrl, available,
        ...((item?.role ?? role) === "EXTRA" ? { maxPerPlate: maxPerPlate && Number(maxPerPlate) > 0 ? Number(maxPerPlate) : null } : {}),
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
  const groups = groupsForRole(effectiveRole || undefined);
  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {!item && (
        <fieldset>
          <legend className={label}>What is it?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FOOD_ROLES.map((value) => (
              <label key={value} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${role === value ? "border-black bg-white" : "border-black/10 bg-white/60"}`}>
                <input type="radio" name="role" value={value} checked={role === value} onChange={() => { setRole(value); setGroup(""); if (value === "SOUP" && !price) setPrice("0"); }} className="mt-1 accent-black" />
                <span><span className="block text-sm font-black">{ROLE_LABELS[value]}</span><span className="block text-xs text-black/55">{ROLE_HELP[value]}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {groups.length > 0 && (
        <fieldset>
          <legend className={label}>{effectiveRole === "BASE" ? "Plate group" : "Add-on group"}</legend>
          {item && !item.group && <p className="mb-2 rounded-lg bg-[#fff3d6] px-2.5 py-1.5 text-xs font-semibold text-[#7a4a00]">This item was added before groups existed. Choose one so students find it in the right place.</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            {groups.map((value) => (
              <label key={value} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${group === value ? "border-black bg-white" : "border-black/10 bg-white/60"}`}>
                <input type="radio" name={`group-${item?.id ?? "new"}`} value={value} checked={group === value} onChange={() => setGroup(value)} className="mt-1 accent-black" />
                <span><span className="block text-sm font-black">{GROUP_LABELS[value]}</span><span className="block text-xs text-black/55">{GROUP_HELP[value]}</span></span>
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
          {effectiveRole === "SOUP" && <p className="mt-1 text-xs text-black/55">0 = free with the plate.</p>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`item-section-${item?.id ?? "new"}`} className={label}>Menu section <span className="font-medium text-black/45">Optional</span></label>
          <input id={`item-section-${item?.id ?? "new"}`} value={section} onChange={(event) => setSection(event.target.value)} list="food-sections" maxLength={120} placeholder="e.g. Rice and meals" className="pk-input" />
        </div>
        {effectiveRole === "EXTRA" && (
          <div>
            <label htmlFor={`item-max-${item?.id ?? "new"}`} className={label}>Limit per plate <span className="font-medium text-black/45">Optional</span></label>
            <input id={`item-max-${item?.id ?? "new"}`} value={maxPerPlate} onChange={(event) => setMaxPerPlate(event.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="No limit" className="pk-input" />
            <p className="mt-1 text-xs text-black/55">Leave empty so students can add as many as they want. Set a number only to cap it (e.g. 1 egg).</p>
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

/** The admin list in the order students meet things: meals, then plate bases by group, soups, add-ons by group. */
const LIST_ORDER: Array<{ key: string; role: FoodRole; group?: FoodGroup | null; title: string }> = [
  { key: "meal", role: "MEAL", title: "Ready-made meals" },
  { key: "swallow", role: "BASE", group: "SWALLOW", title: "Plate bases · Swallow" },
  { key: "rice", role: "BASE", group: "RICE", title: "Plate bases · Rice" },
  { key: "other", role: "BASE", group: "OTHER", title: "Plate bases · Others" },
  { key: "base-none", role: "BASE", group: null, title: "Plate bases · no group yet" },
  { key: "soup", role: "SOUP", title: "Soups" },
  { key: "protein", role: "EXTRA", group: "PROTEIN", title: "Add-ons · Protein" },
  { key: "side", role: "EXTRA", group: "SIDE", title: "Add-ons · Sides" },
  { key: "drink", role: "EXTRA", group: "DRINK", title: "Add-ons · Drinks" },
  { key: "extra-none", role: "EXTRA", group: null, title: "Add-ons · no group yet" },
];

export function FoodMenuManager({ shopId, items }: { shopId: string; items: AdminMenuItem[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const sections = [...new Set(items.map((item) => item.section).filter((value): value is string => Boolean(value)))];
  const ungrouped = items.filter((item) => (item.role === "BASE" || item.role === "EXTRA") && !item.group).length;

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
      {ungrouped > 0 && <p role="status" className="rounded-xl bg-[#fff3d6] px-3 py-2 text-sm font-semibold text-[#7a4a00]">{ungrouped} {ungrouped === 1 ? "item needs" : "items need"} a group (marked “Set a group” below). Until then students see {ungrouped === 1 ? "it" : "them"} under the old layout.</p>}
      {LIST_ORDER.map(({ key, role, group: listGroup, title }) => {
        const rows = items.filter((item) => item.role === role && (listGroup === undefined || item.group === listGroup));
        if (!rows.length) return null;
        return (
          <section key={key} aria-labelledby={`menu-${key}`}>
            <h3 id={`menu-${key}`} className="text-xs font-black uppercase tracking-wider text-black/50">{title}</h3>
            <ul className="mt-2 divide-y divide-black/5 overflow-hidden rounded-2xl border border-black/10 bg-white">
              {rows.map((item) => (
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
                        <p className="text-xs text-black/55">{foodPriceLabel(item.price)}{item.role === "BASE" && item.group ? ` · ${soupRule(item) === "required" ? "with free soup" : "no soup"}` : ""}{item.section ? ` · ${item.section}` : ""}{item.role === "EXTRA" ? (item.maxPerPlate ? ` · max ${item.maxPerPlate} per plate` : " · no limit") : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {(item.role === "BASE" || item.role === "EXTRA") && !item.group && <span className="rounded-full bg-[#fff3d6] px-2.5 py-1 text-xs font-black text-[#7a4a00]">Set a group</span>}
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
      {!items.length && <p className="rounded-2xl border border-dashed border-black/15 bg-white p-5 text-sm text-black/60">No menu items yet. Add the shop’s ready-made meals, or the plate bases, soups and add-ons students build plates from.</p>}
      {adding ? <ItemForm shopId={shopId} sections={sections} onDone={() => setAdding(false)} /> : <button type="button" onClick={() => { setEditing(null); setAdding(true); }} className="pk-btn pk-btn-primary">+ Add menu item</button>}
    </div>
  );
}
