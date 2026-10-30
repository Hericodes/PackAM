"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductImageUpload } from "./ProductImageUpload";
import {
  PRODUCT_DESCRIPTION_MAX,
  formatNaira,
  newProductRequestId,
  nextDraftAfterCreate,
  parseNairaInput,
  productDraftPayload,
  validateProductDraft,
  type ProductDraft,
  type ProductDraftErrors,
  type ProductDraftField,
} from "../../lib/products/product-form";

type Category = {
  id: string;
  name: string;
  subcategories?: Array<{ id: string; name: string }>;
};

type ProductFormProps = {
  categories: Category[];
  labels?: Array<{ id: string; name: string }>;
  initialData?: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    categoryId: string;
    customerPrice: number;
    status: "ACTIVE" | "INACTIVE";
    subcategoryId?: string | null;
    labelIds?: string[];
    stockQuantity?: number | null;
    hasVariants?: boolean;
  };
};

type Saved = { id: string; name: string; price: number | null; category: string; created: boolean };

const FIELD_ORDER: ProductDraftField[] = ["name", "categoryId", "price", "description", "stock"];
const FIELD_IDS: Record<ProductDraftField, string> = { name: "name", categoryId: "category", price: "price", description: "description", stock: "stock" };

const labelClass = "mb-2 block text-sm font-black";
const errorClass = "mt-1.5 text-xs font-semibold text-[#c92d24]";

export function ProductForm({ categories, labels = [], initialData }: ProductFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialData?.id);

  const [draft, setDraft] = useState<ProductDraft>({
    name: initialData?.name ?? "",
    categoryId: initialData?.categoryId ?? "",
    // ₦0 means the price hasn't been set yet, so the field starts empty rather than showing 0.
    price: initialData && initialData.customerPrice >= 1 ? initialData.customerPrice.toString() : "",
    description: initialData?.description ?? "",
    status: initialData?.status ?? "ACTIVE",
    imageUrl: initialData?.imageUrl ?? "",
    subcategoryId: initialData?.subcategoryId ?? "",
    labelIds: initialData?.labelIds ?? [],
    stock: initialData?.stockQuantity !== null && initialData?.stockQuantity !== undefined ? String(initialData.stockQuantity) : "",
    hasVariants: initialData?.hasVariants ?? false,
  });
  const subcategories = categories.find((category) => category.id === draft.categoryId)?.subcategories ?? [];
  const [errors, setErrors] = useState<ProductDraftErrors>({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  // Remounts the uploader for "Add another", so no upload state carries over.
  const [formKey, setFormKey] = useState(0);
  const submitting = useRef(false);
  // One id per create attempt: retrying after a network error reuses it, so the server never makes two.
  const requestId = useRef<string | null>(null);

  function update<K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field in errors) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || imageBusy) return;
    setServerError("");

    const found = validateProductDraft(draft, isEditing);
    setErrors(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) {
      if (first === "description" || first === "stock") (document.getElementById("more-options") as HTMLDetailsElement | null)?.setAttribute("open", "");
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }

    submitting.current = true;
    setSaving(true);
    if (!isEditing && !requestId.current) requestId.current = newProductRequestId();
    try {
      const response = await fetch(isEditing ? `/api/products/${initialData!.id}` : "/api/products", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...productDraftPayload(draft), ...(isEditing ? {} : { requestId: requestId.current }) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The product couldn’t be saved. Your details are still here — try again.");
      const price = parseNairaInput(draft.price);
      setSaved({
        id: data.id,
        name: data.name ?? draft.name.trim(),
        price: typeof price === "number" ? price : null,
        category: categories.find((category) => category.id === draft.categoryId)?.name ?? "",
        created: !isEditing,
      });
      requestId.current = null;
      router.refresh();
    } catch (error) {
      setServerError(error instanceof TypeError ? "No connection to PackAM. Check your internet and save again — nothing will be added twice." : error instanceof Error ? error.message : "The product couldn’t be saved.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function addAnother() {
    setDraft((current) => nextDraftAfterCreate(current));
    setErrors({});
    setServerError("");
    setSaved(null);
    setFormKey((key) => key + 1);
    requestAnimationFrame(() => document.getElementById("name")?.focus());
  }

  if (saved) {
    return (
      <div role="status" className="space-y-5">
        <div className="flex items-start gap-3 rounded-2xl border border-[#16803c]/20 bg-[#e9f8ee] p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#16803c] text-lg font-black text-white" aria-hidden="true">✓</span>
          <div className="min-w-0">
            <p className="font-black">{saved.created ? "Product added" : "Changes saved"}</p>
            <p className="mt-0.5 wrap-break-word text-sm text-black/70">
              {saved.name}
              {saved.price !== null && ` · ${formatNaira(saved.price)}`}
              {saved.category && ` · ${saved.category}`}
            </p>
            <p className="mt-1 text-xs text-black/55">{draft.status === "ACTIVE" ? "Students can see it in the marketplace now." : "It’s hidden from students until you make it visible."}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {saved.created
            ? <button type="button" onClick={addAnother} className="pk-btn pk-btn-primary pk-btn-lg">+ Add another product</button>
            : <button type="button" onClick={() => setSaved(null)} className="pk-btn pk-btn-secondary pk-btn-lg">Keep editing</button>}
          <Link href="/admin/products" className={`pk-btn pk-btn-lg ${saved.created ? "pk-btn-secondary" : "pk-btn-primary"}`}>Back to products</Link>
          {saved.created && saved.id && <Link href={`/admin/products/${saved.id}/edit#options`} className="pk-btn pk-btn-ghost pk-btn-lg">Add options (sizes, colours…)</Link>}
        </div>
        {saved.created && <p className="text-xs text-black/50">Adding another keeps the category ({saved.category}) and clears the rest.</p>}
      </div>
    );
  }

  const busy = saving || imageBusy;
  const fieldProps = (field: ProductDraftField) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${FIELD_IDS[field]}-error` : undefined,
  });

  return (
    <form key={formKey} onSubmit={handleSubmit} noValidate className="space-y-6">
      {serverError && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {serverError}
        </div>
      )}

      <div>
        <label htmlFor="name" className={labelClass}>Product name</label>
        <input id="name" type="text" value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. A4 Project File" maxLength={120} autoComplete="off" className="pk-input" disabled={saving} {...fieldProps("name")} />
        {errors.name && <p id="name-error" className={errorClass}>{errors.name}</p>}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="category" className={labelClass}>Category</label>
          <select id="category" value={draft.categoryId} onChange={(event) => { update("categoryId", event.target.value); update("subcategoryId", ""); }} className="pk-input" disabled={saving} {...fieldProps("categoryId")}>
            <option value="">Choose a category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          {errors.categoryId && <p id="category-error" className={errorClass}>{errors.categoryId}</p>}
          {subcategories.length > 0 && (
            <div className="mt-3">
              <label htmlFor="subcategory" className="mb-1.5 block text-xs font-black">Subcategory <span className="font-medium text-black/45">Optional</span></label>
              <select id="subcategory" value={draft.subcategoryId} onChange={(event) => update("subcategoryId", event.target.value)} className="pk-input" disabled={saving}>
                <option value="">None</option>
                {subcategories.map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="price" className={labelClass}>Selling price</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-black text-black/55" aria-hidden="true">₦</span>
            <input id="price" type="text" inputMode="numeric" value={draft.price} onChange={(event) => update("price", event.target.value)} placeholder={isEditing ? "Not set yet" : "e.g. 1500"} autoComplete="off" className="pk-input pl-9 disabled:bg-black/5" disabled={saving || draft.hasVariants} {...fieldProps("price")} />
          </div>
          {errors.price
            ? <p id="price-error" className={errorClass}>{errors.price}</p>
            : <p className="mt-1.5 text-xs text-black/50">{draft.hasVariants ? "Students see “From” this price: each option has its own price below." : "What the student pays, in whole naira. Delivery is added at checkout."}</p>}
        </div>
      </div>

      <div>
        <p className={labelClass} id="photo-label">Product photo <span className="font-medium text-black/45">Optional</span></p>
        <div role="group" aria-labelledby="photo-label">
          <ProductImageUpload value={draft.imageUrl} onChange={(url) => update("imageUrl", url)} onBusyChange={setImageBusy} disabled={saving} />
        </div>
        <p className="mt-2 text-xs text-black/50">A clear photo of the actual product. Without one, students see a clean illustration for its category.</p>
      </div>

      {labels.length > 0 && (
        <fieldset>
          <legend className={labelClass}>Labels <span className="font-medium text-black/45">Optional</span></legend>
          <div className="flex flex-wrap gap-2">
            {labels.map((label) => {
              const on = draft.labelIds.includes(label.id);
              return <button key={label.id} type="button" aria-pressed={on} onClick={() => update("labelIds", on ? draft.labelIds.filter((id) => id !== label.id) : [...draft.labelIds, label.id])} disabled={saving} className={`min-h-10 rounded-full border px-3.5 text-sm font-bold ${on ? "border-black bg-black text-white" : "border-black/15 bg-white"}`}>{on ? "✓ " : ""}{label.name}</button>;
            })}
          </div>
        </fieldset>
      )}

      <details id="more-options" className="group rounded-2xl border border-black/10 bg-white" open={Boolean(isEditing && (initialData?.description || initialData?.status === "INACTIVE")) || undefined}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-black [&::-webkit-details-marker]:hidden">
          <span>More options <span className="font-medium text-black/45">Description, visibility, stock</span></span>
          <span aria-hidden="true" className="text-black/45 transition group-open:rotate-180">▾</span>
        </summary>
        <div className="space-y-5 border-t border-black/5 p-4">
          <div>
            <label htmlFor="description" className={labelClass}>Description <span className="font-medium text-black/45">Optional</span></label>
            <textarea id="description" value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="Size, brand, colour, pack size — anything a student should know." rows={3} className="pk-input resize-y py-3" disabled={saving} {...fieldProps("description")} />
            {errors.description
              ? <p id="description-error" className={errorClass}>{errors.description}</p>
              : <p className="mt-1.5 text-right text-xs text-black/40">{draft.description.trim().length}/{PRODUCT_DESCRIPTION_MAX}</p>}
          </div>

          <fieldset>
            <legend className={labelClass}>Visibility</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([["ACTIVE", "Visible to students", "Listed in the marketplace."], ["INACTIVE", "Hidden", "Saved, but students can’t see or buy it."]] as const).map(([value, title, body]) => (
                <label key={value} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 ${draft.status === value ? "border-black bg-[#fffdf7]" : "border-black/10"}`}>
                  <input type="radio" name="status" value={value} checked={draft.status === value} onChange={() => update("status", value)} className="mt-1 accent-black" disabled={saving} />
                  <span><span className="block text-sm font-black">{title}</span><span className="block text-xs text-black/55">{body}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          {draft.hasVariants ? (
            <p className="rounded-xl bg-[#f7f5ee] px-3 py-2 text-xs leading-5 text-black/60"><span className="font-black text-black/75">Stock:</span> this product has options, so stock is set for each option below.</p>
          ) : (
            <div>
              <label htmlFor="stock" className={labelClass}>Stock quantity <span className="font-medium text-black/45">Optional</span></label>
              <input id="stock" type="text" inputMode="numeric" value={draft.stock} onChange={(event) => update("stock", event.target.value)} placeholder="Not tracked" autoComplete="off" className="pk-input" disabled={saving} {...fieldProps("stock")} />
              {errors.stock
                ? <p id="stock-error" className={errorClass}>{errors.stock}</p>
                : <p className="mt-1.5 text-xs leading-5 text-black/50">Leave blank if runners buy it from shops on demand (as now). Enter a number only if PackAM holds this stock: students can’t order more than you have, and it goes down as orders are paid.</p>}
            </div>
          )}
        </div>
      </details>

      <div className="flex flex-col gap-3 border-t border-black/5 pt-6 sm:flex-row">
        <button type="submit" disabled={busy} aria-busy={saving} className="pk-btn pk-btn-primary pk-btn-lg">
          {saving ? (isEditing ? "Saving…" : "Adding…") : imageBusy ? "Waiting for the photo…" : isEditing ? "Save changes" : "Add product"}
        </button>
        <Link href="/admin/products" aria-disabled={saving} className={`pk-btn pk-btn-secondary pk-btn-lg ${saving ? "pointer-events-none opacity-50" : ""}`}>Cancel</Link>
      </div>
    </form>
  );
}
