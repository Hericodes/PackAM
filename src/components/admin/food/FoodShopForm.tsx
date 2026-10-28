"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductImageUpload } from "../../products/ProductImageUpload";

type Shop = { id: string; name: string; description: string | null; location: string | null; imageUrl: string | null; isOpen: boolean; listedInFood: boolean; availableItems: number };

const label = "mb-1.5 block text-sm font-black";

/** Create a food shop (no shop given) or edit one, including its open and listing switches. */
export function FoodShopForm({ shop }: { shop?: Shop }) {
  const router = useRouter();
  const [name, setName] = useState(shop?.name ?? "");
  const [description, setDescription] = useState(shop?.description ?? "");
  const [location, setLocation] = useState(shop?.location ?? "");
  const [imageUrl, setImageUrl] = useState(shop?.imageUrl ?? "");
  const [imageBusy, setImageBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sending = useRef(false);

  async function send(body: Record<string, unknown>, what: string) {
    if (sending.current) return null;
    sending.current = true;
    setBusy(what); setError(""); setNotice("");
    try {
      const response = await fetch(shop ? `/api/admin/food/shops/${shop.id}` : "/api/admin/food/shops", { method: shop ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The shop couldn’t be saved.");
      return data as { id: string };
    } catch (cause) {
      setError(cause instanceof TypeError ? "No connection. Nothing was changed — try again." : cause instanceof Error ? cause.message : "The shop couldn’t be saved.");
      return null;
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter the shop’s name.");
    const saved = await send({ name: name.trim(), description: description.trim(), location: location.trim(), imageUrl }, "save");
    if (!saved) return;
    if (shop) { setNotice("Saved."); router.refresh(); }
    else router.push(`/admin/food/${saved.id}`);
  }

  async function toggle(key: "isOpen" | "listedInFood", value: boolean) {
    if (await send({ [key]: value }, key)) router.refresh();
  }

  return (
    <div className="space-y-4">
      {shop && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className={`rounded-2xl border p-4 ${shop.isOpen ? "border-[#16803c]/30 bg-[#e9f8ee]" : "border-black/10 bg-white"}`}>
            <p className="text-sm font-black">{shop.isOpen ? "Open — taking orders" : "Closed — not taking orders"}</p>
            <p className="mt-1 text-xs text-black/60">Students can’t order from a closed shop. Checked again when they pay.</p>
            <button type="button" onClick={() => void toggle("isOpen", !shop.isOpen)} disabled={busy !== null} className={`pk-btn pk-btn-sm mt-3 ${shop.isOpen ? "pk-btn-secondary" : "pk-btn-primary"}`}>{busy === "isOpen" ? "Saving…" : shop.isOpen ? "Close shop" : "Open shop"}</button>
          </div>
          <div className={`rounded-2xl border p-4 ${shop.listedInFood ? "border-[#16803c]/30 bg-[#e9f8ee]" : "border-black/10 bg-white"}`}>
            <p className="text-sm font-black">{shop.listedInFood ? "Shown in Food" : "Hidden from students"}</p>
            <p className="mt-1 text-xs text-black/60">{shop.availableItems ? `${shop.availableItems} available menu ${shop.availableItems === 1 ? "item" : "items"}.` : "No available menu items yet — students would see an empty menu."}</p>
            <button type="button" onClick={() => void toggle("listedInFood", !shop.listedInFood)} disabled={busy !== null} className={`pk-btn pk-btn-sm mt-3 ${shop.listedInFood ? "pk-btn-secondary" : "pk-btn-primary"}`}>{busy === "listedInFood" ? "Saving…" : shop.listedInFood ? "Hide from Food" : "Show in Food"}</button>
          </div>
        </div>
      )}

      <form onSubmit={submit} noValidate className="space-y-4 rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-6">
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-xl bg-[#e9f8ee] px-3 py-2 text-sm font-semibold text-[#16803c]">{notice}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="shop-name" className={label}>Shop name</label><input id="shop-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="e.g. the shop’s signboard name" className="pk-input" /></div>
          <div><label htmlFor="shop-location" className={label}>Location <span className="font-medium text-black/45">Optional</span></label><input id="shop-location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} placeholder="Where runners find it" className="pk-input" /></div>
        </div>
        <div><label htmlFor="shop-description" className={label}>Short description <span className="font-medium text-black/45">Optional</span></label><textarea id="shop-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} placeholder="What students should know about this shop" className="pk-input resize-y py-3" /></div>
        <div><p className={label}>Shop photo <span className="font-medium text-black/45">Optional</span></p><ProductImageUpload value={imageUrl} onChange={setImageUrl} onBusyChange={setImageBusy} disabled={busy !== null} /></div>
        <p className="text-xs text-black/55">Students see the name, description, location and photo only. Phone numbers and notes stay internal.</p>
        <button type="submit" disabled={busy !== null || imageBusy} className="pk-btn pk-btn-primary pk-btn-lg">{busy === "save" ? "Saving…" : imageBusy ? "Waiting for the photo…" : shop ? "Save shop details" : "Create shop"}</button>
      </form>
    </div>
  );
}
