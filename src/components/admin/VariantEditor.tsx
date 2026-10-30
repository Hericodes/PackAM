"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductImageUpload } from "../products/ProductImageUpload";
import { generateCombinations, MAX_OPTIONS, MAX_VALUES_PER_OPTION, optionKeyFor } from "../../lib/products/variants";
import { parseNairaInput, parseStock } from "../../lib/products/product-form";

type Value = { key: string; value: string };
type Option = { key: string; name: string; values: Value[] };
type ExistingVariant = { id: string; valueKeys: string[]; price: number; stockQuantity: number | null; sku: string | null; active: boolean; imageUrl: string | null; inUse: boolean };
type Row = { price: string; stock: string; sku: string; active: boolean; imageUrl: string; existing: boolean; inUse: boolean };

const cell = "w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm";
const chip = "inline-flex min-h-9 items-center gap-1 rounded-full border border-black/15 bg-white pl-3 pr-1 text-sm font-bold";

let counter = 0;
const newKey = (prefix: string) => `new-${prefix}-${Date.now().toString(36)}-${counter++}`;

/**
 * Options (Colour, Size…) and the variants they make, for one product. Every combination is listed;
 * the admin prices it, optionally tracks its stock, and marks it available or not. A combination that is
 * unavailable and was never priced isn't created at all, so students can never buy it.
 */
export function VariantEditor({ productId, initialOptions, initialVariants }: { productId: string; initialOptions: Option[]; initialVariants: ExistingVariant[] }) {
  const router = useRouter();
  const [options, setOptions] = useState<Option[]>(initialOptions);
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(initialVariants.map((variant) => [optionKeyFor(variant.valueKeys), {
    price: String(variant.price), stock: variant.stockQuantity === null ? "" : String(variant.stockQuantity), sku: variant.sku ?? "",
    active: variant.active, imageUrl: variant.imageUrl ?? "", existing: true, inUse: variant.inUse,
  }])));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [bulk, setBulk] = useState({ price: "", stock: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sending = useRef(false);

  const combos = useMemo(() => generateCombinations(options.map((option) => ({ values: option.values }))), [options]);
  const rowFor = (combo: Value[]): Row => rows[optionKeyFor(combo.map((value) => value.key))] ?? { price: "", stock: "", sku: "", active: true, imageUrl: "", existing: false, inUse: false };
  const setRow = (combo: Value[], change: Partial<Row>) => setRows((current) => { const key = optionKeyFor(combo.map((value) => value.key)); return { ...current, [key]: { ...rowFor(combo), ...current[key], ...change } }; });

  const updateOption = (key: string, change: (option: Option) => Option) => setOptions((current) => current.map((option) => (option.key === key ? change(option) : option)));
  function addOption() {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((current) => [...current, { key: newKey("option"), name: "", values: [] }]);
  }
  function addValue(option: Option) {
    const value = (drafts[option.key] ?? "").trim();
    if (!value) return;
    if (option.values.some((existing) => existing.value.toLowerCase() === value.toLowerCase())) { setError(`“${option.name || "This option"}” already has “${value}”.`); return; }
    if (option.values.length >= MAX_VALUES_PER_OPTION) return;
    updateOption(option.key, (current) => ({ ...current, values: [...current.values, { key: newKey("value"), value }] }));
    setDrafts((current) => ({ ...current, [option.key]: "" }));
    setError("");
  }

  async function save(clearAll = false) {
    if (sending.current || imageBusy) return;
    setError(""); setNotice("");
    const included: Array<{ valueKeys: string[]; price: number; stockQuantity: number | null; sku: string | null; active: boolean; imageUrl: string | null }> = [];
    if (!clearAll) {
      for (const combo of combos) {
        const row = rowFor(combo);
        const label = combo.map((value) => value.value).join(" / ");
        // Unavailable and never priced: not created at all.
        if (!row.existing && !row.active && !row.price.trim()) continue;
        const price = parseNairaInput(row.price);
        if (typeof price !== "number" || price < 1) return setError(`${label}: set a price of at least ₦1${row.active ? "" : ", or leave it unavailable with no price so it isn’t created"}.`);
        const stock = parseStock(row.stock);
        if (stock === "invalid") return setError(`${label}: stock must be a whole number of 0 or more, or blank.`);
        included.push({ valueKeys: combo.map((value) => value.key), price, stockQuantity: stock, sku: row.sku.trim() || null, active: row.active, imageUrl: row.imageUrl || null });
      }
      if (options.some((option) => !option.name.trim())) return setError("Give every option group a name, like Colour or Size.");
    }
    sending.current = true; setSaving(true);
    try {
      const body = clearAll ? { options: [], variants: [] } : { options: options.map((option) => ({ key: option.key, name: option.name, values: option.values })), variants: included };
      const response = await fetch(`/api/admin/products/${productId}/variants`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The options couldn’t be saved.");
      setNotice(clearAll ? "Options removed. This is a simple product again — set its price above." : `Saved ${data.variants} ${data.variants === 1 ? "variant" : "variants"}.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof TypeError ? "No connection. Nothing was changed — try again." : cause instanceof Error ? cause.message : "The options couldn’t be saved.");
    } finally {
      sending.current = false; setSaving(false);
    }
  }

  return (
    <section id="options" aria-labelledby="options-title" className="scroll-mt-24 rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-6">
      <h2 id="options-title" className="text-xl font-black">Options and variants</h2>
      <p className="mt-1 text-sm text-black/60">For products that come in different colours, sizes, types or temperatures. Skip this for simple products.</p>

      <div className="mt-4 space-y-3">
        {options.map((option, index) => (
          <div key={option.key} className="rounded-2xl border border-black/10 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-40 flex-1 text-xs font-bold">Option {index + 1} name
                <input value={option.name} onChange={(event) => updateOption(option.key, (current) => ({ ...current, name: event.target.value }))} maxLength={40} placeholder="e.g. Colour" className={`${cell} mt-1`} />
              </label>
              <button type="button" onClick={() => setOptions((current) => current.filter((entry) => entry.key !== option.key))} className="min-h-10 rounded-full border border-[#c92d24]/30 px-3 text-xs font-black text-[#c92d24]">Remove option</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {option.values.map((value) => (
                <span key={value.key} className={chip}>
                  <input aria-label={`Rename ${value.value}`} value={value.value} onChange={(event) => updateOption(option.key, (current) => ({ ...current, values: current.values.map((entry) => (entry.key === value.key ? { ...entry, value: event.target.value } : entry)) }))} maxLength={40} className="w-[max(3rem,calc(var(--len)*1ch))] bg-transparent outline-none" style={{ ["--len" as string]: value.value.length + 1 }} />
                  <button type="button" aria-label={`Remove ${value.value}`} onClick={() => updateOption(option.key, (current) => ({ ...current, values: current.values.filter((entry) => entry.key !== value.key) }))} className="flex h-7 w-7 items-center justify-center rounded-full text-black/50 hover:bg-black/5">×</button>
                </span>
              ))}
              <span className="inline-flex gap-1">
                <input aria-label={`Add a value to ${option.name || "this option"}`} value={drafts[option.key] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [option.key]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addValue(option); } }} maxLength={40} placeholder="Add value" className={`${cell} w-32`} />
                <button type="button" onClick={() => addValue(option)} className="min-h-10 rounded-full bg-black px-3 text-xs font-black text-white">Add</button>
              </span>
            </div>
          </div>
        ))}
        {options.length < MAX_OPTIONS && <button type="button" onClick={addOption} className="pk-btn pk-btn-secondary">+ Add option group</button>}
      </div>

      {combos.length > 0 && (
        <>
          <div className="mt-5 flex flex-wrap items-end gap-2 rounded-2xl bg-[#f7f5ee] p-3">
            <label className="w-32 text-xs font-bold">Price for all (₦)<input value={bulk.price} onChange={(event) => setBulk({ ...bulk, price: event.target.value })} inputMode="numeric" className={`${cell} mt-1`} /></label>
            <label className="w-32 text-xs font-bold">Stock for all<input value={bulk.stock} onChange={(event) => setBulk({ ...bulk, stock: event.target.value })} inputMode="numeric" placeholder="Not tracked" className={`${cell} mt-1`} /></label>
            <button type="button" onClick={() => combos.forEach((combo) => setRow(combo, { ...(bulk.price.trim() ? { price: bulk.price } : {}), stock: bulk.stock }))} className="min-h-10 rounded-full border border-black/15 bg-white px-4 text-xs font-black">Apply to all {combos.length}</button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="pk-stack-table w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-black/50"><tr><th className="px-2 py-2">Combination</th><th className="px-2 py-2">Price (₦)</th><th className="px-2 py-2">Stock</th><th className="px-2 py-2">SKU</th><th className="px-2 py-2">Available</th><th className="px-2 py-2">Photo</th></tr></thead>
              <tbody className="divide-y divide-black/5">
                {combos.map((combo) => {
                  const key = optionKeyFor(combo.map((value) => value.key));
                  const row = rowFor(combo);
                  const label = combo.map((value) => value.value || "?").join(" / ");
                  return [
                    <tr key={key} className={row.active ? "" : "bg-black/[0.03]"}>
                      <td data-label="Combination" className="px-2 py-2 font-bold">{label}{row.inUse && <span className="ml-1 text-xs font-normal text-black/45">(ordered)</span>}</td>
                      <td data-label="Price (₦)" className="px-2 py-2"><input aria-label={`Price for ${label}`} value={row.price} onChange={(event) => setRow(combo, { price: event.target.value })} inputMode="numeric" className={cell} /></td>
                      <td data-label="Stock" className="px-2 py-2"><input aria-label={`Stock for ${label}`} value={row.stock} onChange={(event) => setRow(combo, { stock: event.target.value })} inputMode="numeric" placeholder="Not tracked" className={cell} /></td>
                      <td data-label="SKU" className="px-2 py-2"><input aria-label={`SKU for ${label}`} value={row.sku} onChange={(event) => setRow(combo, { sku: event.target.value })} maxLength={64} placeholder="Optional" className={cell} /></td>
                      <td data-label="Available" className="px-2 py-2"><label className="inline-flex min-h-10 items-center gap-2 font-bold"><input type="checkbox" checked={row.active} onChange={(event) => setRow(combo, { active: event.target.checked })} className="h-5 w-5 accent-black" /> {row.active ? "Yes" : "No"}</label></td>
                      <td data-label="Photo" className="px-2 py-2"><button type="button" onClick={() => setPhotoFor(photoFor === key ? null : key)} className="min-h-10 rounded-full border border-black/15 px-3 text-xs font-black">{row.imageUrl ? "Change" : "Add"}</button></td>
                    </tr>,
                    photoFor === key ? <tr key={`${key}-photo`}><td colSpan={6} className="px-2 pb-3"><ProductImageUpload value={row.imageUrl} onChange={(url) => setRow(combo, { imageUrl: url })} onBusyChange={setImageBusy} /></td></tr> : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-black/55">A combination you mark unavailable and leave unpriced isn’t created, so students never see it. Ordered combinations can be made unavailable but not removed.</p>
        </>
      )}

      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-xl bg-[#e9f8ee] px-3 py-2 text-sm font-semibold text-[#16803c]">{notice}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={saving || imageBusy || !options.length} className="pk-btn pk-btn-primary">{saving ? "Saving…" : imageBusy ? "Waiting for the photo…" : "Save options and variants"}</button>
        {initialOptions.length > 0 && <button type="button" onClick={() => { if (window.confirm("Remove all options and sell this as a simple product? Combinations that were ordered must be made unavailable instead.")) void save(true); }} disabled={saving} className="pk-btn pk-btn-secondary">Remove all options</button>}
      </div>
    </section>
  );
}
