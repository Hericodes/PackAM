"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductImageUpload } from "../products/ProductImageUpload";

type Subcategory = { id: string; name: string; description: string | null; isActive: boolean; sortOrder: number; _count: { products: number } };
type Category = { id: string; name: string; slug: string; description: string | null; imageUrl: string | null; isActive: boolean; sortOrder: number; _count: { products: number }; subcategories: Subcategory[] };

const input = "mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-normal";
const label = "text-xs font-bold";
const smallButton = "min-h-10 rounded-full px-4 text-xs font-black disabled:opacity-50";

function useSender() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  async function send(url: string, method: string, body: unknown) {
    if (sending.current) return false;
    sending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "That couldn’t be saved.");
      router.refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof TypeError ? "No connection. Nothing was changed — try again." : cause instanceof Error ? cause.message : "That couldn’t be saved.");
      return false;
    } finally {
      sending.current = false; setBusy(false);
    }
  }
  return { busy, error, send };
}

function SubcategoryRow({ sub }: { sub: Subcategory }) {
  const { busy, error, send } = useSender();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sub.name);
  const [order, setOrder] = useState(String(sub.sortOrder));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send(`/api/admin/subcategories/${sub.id}`, "PATCH", { name, sortOrder: Number(order) || 0 })) setEditing(false);
  }
  return (
    <li className="py-2">
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <label className={`${label} min-w-40 flex-1`}>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={input} /></label>
          <label className={`${label} w-24`}>Order<input value={order} onChange={(event) => setOrder(event.target.value)} inputMode="numeric" className={input} /></label>
          <button disabled={busy} className={`${smallButton} bg-black text-white`}>Save</button>
          <button type="button" onClick={() => setEditing(false)} className={`${smallButton} border border-black/15`}>Cancel</button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`min-w-0 flex-1 text-sm font-bold ${sub.isActive ? "" : "text-black/45"}`}>{sub.name} <span className="font-normal text-black/45">· {sub._count.products} products · order {sub.sortOrder}{sub.isActive ? "" : " · hidden"}</span></span>
          <button type="button" onClick={() => setEditing(true)} className={`${smallButton} border border-black/15`}>Edit</button>
          <button type="button" disabled={busy} onClick={() => void send(`/api/admin/subcategories/${sub.id}`, "PATCH", { isActive: !sub.isActive })} className={`${smallButton} border border-black/15`}>{sub.isActive ? "Hide" : "Show"}</button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-red-700">{error}</p>}
    </li>
  );
}

function CategoryCard({ category }: { category: Category }) {
  const { busy, error, send } = useSender();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const [order, setOrder] = useState(String(category.sortOrder));
  const [imageUrl, setImageUrl] = useState(category.imageUrl ?? "");
  const [imageBusy, setImageBusy] = useState(false);
  const [newSub, setNewSub] = useState("");
  const dedicated = category.slug === "food" || category.slug === "printing";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send(`/api/admin/categories/${category.id}`, "PATCH", { name, description, sortOrder: Number(order) || 0, imageUrl })) setEditing(false);
  }
  async function addSub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newSub.trim() && await send("/api/admin/subcategories", "POST", { categoryId: category.id, name: newSub, sortOrder: category.subcategories.length })) setNewSub("");
  }

  return (
    <section className={`rounded-2xl border border-black/5 bg-white p-4 sm:p-5 ${category.isActive ? "" : "opacity-80"}`}>
      {editing ? (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
          <label className={label}>Category name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={input} /></label>
          <label className={label}>Display order<input value={order} onChange={(event) => setOrder(event.target.value)} inputMode="numeric" className={input} /></label>
          <label className={`${label} sm:col-span-2`}>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} rows={2} className={input} /></label>
          <div className="sm:col-span-2"><p className={label}>Category image (optional)</p><div className="mt-1"><ProductImageUpload value={imageUrl} onChange={setImageUrl} onBusyChange={setImageBusy} /></div></div>
          <div className="flex gap-2 sm:col-span-2">
            <button disabled={busy || imageBusy} className={`${smallButton} bg-black text-white`}>{imageBusy ? "Waiting for photo…" : "Save category"}</button>
            <button type="button" onClick={() => setEditing(false)} className={`${smallButton} border border-black/15`}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-black">{category.name} {!category.isActive && <span className="ml-1 rounded-full bg-black/6 px-2 py-0.5 text-xs text-black/60">Hidden</span>}</h2>
            <p className="text-xs text-black/55">{category._count.products} products · order {category.sortOrder}{category.description ? ` · ${category.description}` : ""}</p>
          </div>
          <button type="button" onClick={() => setEditing(true)} className={`${smallButton} border border-black/15`}>Edit</button>
          <button type="button" disabled={busy} onClick={() => void send(`/api/admin/categories/${category.id}`, "PATCH", { isActive: !category.isActive })} className={`${smallButton} border border-black/15`}>{category.isActive ? "Hide" : "Show"}</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}

      {!dedicated && (
        <div className="mt-3 border-t border-black/5 pt-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-black/45">Subcategories</h3>
          {category.subcategories.length ? <ul className="divide-y divide-black/5">{category.subcategories.map((sub) => <SubcategoryRow key={sub.id} sub={sub} />)}</ul> : <p className="mt-1 text-xs text-black/50">None yet.</p>}
          <form onSubmit={addSub} className="mt-2 flex gap-2">
            <label className="sr-only" htmlFor={`new-sub-${category.id}`}>New subcategory in {category.name}</label>
            <input id={`new-sub-${category.id}`} value={newSub} onChange={(event) => setNewSub(event.target.value)} maxLength={80} placeholder={`Add a subcategory to ${category.name}`} className={`${input} mt-0 flex-1`} />
            <button disabled={busy || !newSub.trim()} className={`${smallButton} bg-black text-white`}>Add</button>
          </form>
        </div>
      )}
    </section>
  );
}

export function AdminCategories({ categories }: { categories: Category[] }) {
  const { busy, error, send } = useSender();
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (await send("/api/admin/categories", "POST", { name: data.name, description: data.description, sortOrder: Number(data.sortOrder) || 0 })) form.reset();
  }
  return (
    <>
      <p className="mt-2 text-sm text-black/55">Categories are the broad groups students browse; subcategories narrow them down. Hiding one hides its products from students but never deletes products or order history.</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      <form onSubmit={create} className="mt-5 grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px_auto] sm:items-end sm:p-5">
        <label className={label}>New category<input required name="name" maxLength={80} placeholder="e.g. Hostel Essentials" className={input} /></label>
        <label className={label}>Description<input name="description" maxLength={300} placeholder="Optional" className={input} /></label>
        <label className={label}>Order<input name="sortOrder" inputMode="numeric" placeholder="0" className={input} /></label>
        <button disabled={busy} className={`${smallButton} min-h-11 bg-black text-white`}>Add category</button>
      </form>
      <div className="mt-5 space-y-3">{categories.map((category) => <CategoryCard key={category.id} category={category} />)}</div>
    </>
  );
}
