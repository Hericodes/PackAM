"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Label = { id: string; name: string; isActive: boolean; sortOrder: number; _count: { products: number } };

const input = "mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-normal";
const smallButton = "min-h-10 rounded-full px-4 text-xs font-black disabled:opacity-50";

export function AdminLabels({ labels }: { labels: Label[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", order: "" });
  const [confirmDelete, setConfirmDelete] = useState<Label | null>(null);
  const sending = useRef(false);

  async function send(url: string, method: string, body?: unknown) {
    if (sending.current) return false;
    sending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "That couldn’t be saved.");
      router.refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That couldn’t be saved.");
      return false;
    } finally {
      sending.current = false; setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (await send("/api/admin/labels", "POST", { name: data.name, sortOrder: Number(data.sortOrder) || 0 })) form.reset();
  }

  return (
    <>
      <p className="mt-2 text-sm text-black/55">Labels are small badges like Popular or New Arrival. A product can have several. They don’t change categories, prices or options.</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      <form onSubmit={create} className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 sm:p-5">
        <label className="min-w-48 flex-1 text-xs font-bold">New label<input required name="name" maxLength={30} placeholder="e.g. Best Seller" className={input} /></label>
        <label className="w-24 text-xs font-bold">Order<input name="sortOrder" inputMode="numeric" placeholder="0" className={input} /></label>
        <button disabled={busy} className={`${smallButton} min-h-11 bg-black text-white`}>Add label</button>
      </form>
      <ul className="mt-5 divide-y divide-black/5 overflow-hidden rounded-2xl bg-white">
        {labels.map((label) => (
          <li key={label.id} className="p-3 sm:px-5">
            {editing === label.id ? (
              <form onSubmit={async (event) => { event.preventDefault(); if (await send(`/api/admin/labels/${label.id}`, "PATCH", { name: draft.name, sortOrder: Number(draft.order) || 0 })) setEditing(null); }} className="flex flex-wrap items-end gap-2">
                <label className="min-w-40 flex-1 text-xs font-bold">Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={30} className={input} /></label>
                <label className="w-24 text-xs font-bold">Order<input value={draft.order} onChange={(event) => setDraft({ ...draft, order: event.target.value })} inputMode="numeric" className={input} /></label>
                <button disabled={busy} className={`${smallButton} bg-black text-white`}>Save</button>
                <button type="button" onClick={() => setEditing(null)} className={`${smallButton} border border-black/15`}>Cancel</button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${label.isActive ? "bg-[#fff4c7] text-[#6b4700]" : "bg-black/6 text-black/50"}`}>{label.name}</span>
                <span className="min-w-0 flex-1 text-xs text-black/55">{label._count.products} products · order {label.sortOrder}{label.isActive ? "" : " · hidden from students"}</span>
                <button type="button" onClick={() => { setEditing(label.id); setDraft({ name: label.name, order: String(label.sortOrder) }); }} className={`${smallButton} border border-black/15`}>Edit</button>
                <button type="button" disabled={busy} onClick={() => void send(`/api/admin/labels/${label.id}`, "PATCH", { isActive: !label.isActive })} className={`${smallButton} border border-black/15`}>{label.isActive ? "Hide" : "Show"}</button>
                <button type="button" disabled={busy} onClick={() => setConfirmDelete(label)} className={`${smallButton} border border-[#c92d24]/30 text-[#c92d24]`}>Remove</button>
              </div>
            )}
          </li>
        ))}
        {!labels.length && <li className="p-5 text-sm text-black/55">No labels yet.</li>}
      </ul>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div role="alertdialog" aria-modal="true" aria-labelledby="remove-label-title" className="w-full max-w-md rounded-3xl bg-white p-6">
            <h2 id="remove-label-title" className="text-lg font-black">Remove “{confirmDelete.name}”?</h2>
            <p className="mt-2 text-sm text-black/70">It comes off {confirmDelete._count.products} {confirmDelete._count.products === 1 ? "product" : "products"}. Products, prices and orders aren’t affected. To keep it for later, hide it instead.</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmDelete(null)} className={`${smallButton} min-h-11 border border-black/15`}>Keep label</button>
              <button type="button" disabled={busy} onClick={async () => { if (await send(`/api/admin/labels/${confirmDelete.id}`, "DELETE")) setConfirmDelete(null); }} className={`${smallButton} min-h-11 bg-[#c92d24] text-white`}>Remove label</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
