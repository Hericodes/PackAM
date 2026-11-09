"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "../ui/StatusBadge";
import { describePromo, normalizePromoCode, type PromoType } from "../../lib/promo/promo-rules";
import type { AdminPromoRow, PromoStatus } from "../../lib/promo/promo-admin-input";

type Feedback = { tone: "ok" | "error"; text: string };

const STATUS_TONES: Record<PromoStatus, "success" | "neutral" | "warning"> = { LIVE: "success", PAUSED: "neutral", SCHEDULED: "warning", EXPIRED: "neutral", USED_UP: "neutral" };
const EMPTY = { code: "", type: "FIXED" as PromoType, value: "", maxDiscount: "", minSubtotal: "", maxUses: "", maxUsesPerStudent: "1", startsOn: "", endsOn: "" };
const field = "w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-base outline-none transition placeholder:text-black/40 focus:border-black focus:shadow-[0_0_0_3px_rgba(254,184,10,0.45)] disabled:opacity-60";
const label = "mb-1 block text-sm font-black";
const hint = "mt-1 text-xs text-black/55";

/**
 * Admin → Promo codes: create a code (with a live preview of what students see) and pause or resume existing ones.
 * Codes can't be edited after creation: pause one and create another. The server checks everything again and audits
 * each change. `editable` false (before the promo migration) disables every field and button.
 */
export function PromoCodeManager({ editable, codes }: { editable: boolean; codes: AdminPromoRow[] }) {
  return (
    <>
      <CreatePromoCode editable={editable} />
      <section aria-labelledby="promo-list" className="mt-10">
        <h2 id="promo-list" className="text-xl font-black">Codes</h2>
        {codes.length
          ? <ul className="mt-3 grid gap-3">{codes.map((code) => <PromoCodeCard key={code.id} code={code} editable={editable} />)}</ul>
          : <p className="mt-3 rounded-2xl bg-white p-5 text-sm text-black/55">{editable ? "No promo codes yet. Codes you create appear here with how often they’ve been used." : "Codes appear here after the database update."}</p>}
      </section>
    </>
  );
}

function CreatePromoCode({ editable }: { editable: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const value = Number(form.value.replace(/,/g, ""));
  const cap = form.maxDiscount.trim() ? Number(form.maxDiscount.replace(/,/g, "")) : null;
  const preview = Number.isSafeInteger(value) && value > 0 && (form.type === "FIXED" || value <= 100)
    ? describePromo({ type: form.type, value, maxDiscount: form.type === "PERCENT" && cap && Number.isSafeInteger(cap) ? cap : null, minSubtotal: 0 })
    : null;
  const previewCode = normalizePromoCode(form.code);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editable) return;
    setBusy(true);
    setFeedback(null);
    setFieldErrors({});
    try {
      const response = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, maxDiscount: form.type === "PERCENT" ? form.maxDiscount : "" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.fields && typeof data.fields === "object") setFieldErrors(data.fields);
        throw new Error(typeof data.error === "string" ? data.error : "The promo code couldn’t be saved. Nothing was changed — try again.");
      }
      setFeedback({ tone: "ok", text: `${data.promoCode?.code ?? "The code"} is live. Students can use it at checkout now.` });
      setForm(EMPTY);
      router.refresh();
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : "The promo code couldn’t be saved." });
    } finally {
      setBusy(false);
    }
  }

  const error = (key: string) => fieldErrors[key] ? <p className="mt-1 text-sm font-semibold text-red-700">{fieldErrors[key]}</p> : null;
  const disabled = !editable || busy;

  return (
    <form onSubmit={submit} noValidate aria-labelledby="promo-create" className="mt-6 rounded-2xl bg-white p-4 sm:p-6">
      <h2 id="promo-create" className="text-lg font-black">Create a code</h2>
      <p className="mt-1 text-sm text-black/60">Codes come off the items only. The delivery fee is always paid. Shop and food checkout; not printing.</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="promo-code" className={label}>Code</label>
          <input id="promo-code" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/\s+/g, "").slice(0, 20) }))} placeholder="e.g. WELCOME1K" autoComplete="off" spellCheck={false} className={`${field} font-mono uppercase tracking-wider`} disabled={disabled} aria-invalid={Boolean(fieldErrors.code)} />
          <p className={hint}>3–20 letters and numbers. Students can type it in any case.</p>
          {error("code")}
        </div>

        <fieldset className="sm:col-span-2">
          <legend className={label}>Discount</legend>
          <div className="flex flex-wrap gap-2">
            {([["FIXED", "₦ off"], ["PERCENT", "% off"]] as const).map(([type, text]) => (
              <label key={type} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-bold ${form.type === type ? "border-black bg-[#fff4c7]" : "border-black/15 bg-white"}`}>
                <input type="radio" name="promo-type" value={type} checked={form.type === type} onChange={() => setForm((current) => ({ ...current, type }))} disabled={disabled} className="accent-black" /> {text}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="promo-value" className={label}>{form.type === "FIXED" ? "Naira off" : "Percent off"}</label>
          <input id="promo-value" inputMode="numeric" value={form.value} onChange={set("value")} placeholder={form.type === "FIXED" ? "e.g. 1000" : "e.g. 10"} className={field} disabled={disabled} aria-invalid={Boolean(fieldErrors.value)} />
          {error("value")}
        </div>
        {form.type === "PERCENT" ? (
          <div>
            <label htmlFor="promo-cap" className={label}>Most it can take off <span className="font-medium text-black/50">(optional)</span></label>
            <input id="promo-cap" inputMode="numeric" value={form.maxDiscount} onChange={set("maxDiscount")} placeholder="e.g. 2000" className={field} disabled={disabled} aria-invalid={Boolean(fieldErrors.maxDiscount)} />
            <p className={hint}>In naira. Empty = no cap.</p>
            {error("maxDiscount")}
          </div>
        ) : <div className="hidden sm:block" />}

        <div>
          <label htmlFor="promo-min" className={label}>Minimum items total <span className="font-medium text-black/50">(optional)</span></label>
          <input id="promo-min" inputMode="numeric" value={form.minSubtotal} onChange={set("minSubtotal")} placeholder="e.g. 5000" className={field} disabled={disabled} aria-invalid={Boolean(fieldErrors.minSubtotal)} />
          <p className={hint}>In naira, before delivery. Empty = any order.</p>
          {error("minSubtotal")}
        </div>
        <div>
          <label htmlFor="promo-per-student" className={label}>Uses per student</label>
          <input id="promo-per-student" inputMode="numeric" value={form.maxUsesPerStudent} onChange={set("maxUsesPerStudent")} className={field} disabled={disabled} aria-invalid={Boolean(fieldErrors.maxUsesPerStudent)} />
          {error("maxUsesPerStudent")}
        </div>
        <div>
          <label htmlFor="promo-max-uses" className={label}>Total uses <span className="font-medium text-black/50">(optional)</span></label>
          <input id="promo-max-uses" inputMode="numeric" value={form.maxUses} onChange={set("maxUses")} placeholder="e.g. 100" className={field} disabled={disabled} aria-invalid={Boolean(fieldErrors.maxUses)} />
          <p className={hint}>Across all students. Empty = no limit.</p>
          {error("maxUses")}
        </div>
        <div className="hidden sm:block" />
        <div>
          <label htmlFor="promo-starts" className={label}>Valid from <span className="font-medium text-black/50">(optional)</span></label>
          <input id="promo-starts" type="date" value={form.startsOn} onChange={set("startsOn")} className={field} disabled={disabled} aria-invalid={Boolean(fieldErrors.startsOn)} />
          {error("startsOn")}
        </div>
        <div>
          <label htmlFor="promo-ends" className={label}>Valid until <span className="font-medium text-black/50">(optional)</span></label>
          <input id="promo-ends" type="date" value={form.endsOn} onChange={set("endsOn")} className={field} disabled={disabled} aria-invalid={Boolean(fieldErrors.endsOn)} />
          <p className={hint}>Includes the whole day (campus time).</p>
          {error("endsOn")}
        </div>
      </div>

      <p className="mt-5 rounded-xl bg-[#fffdf7] px-3 py-2.5 text-sm" aria-live="polite">
        {previewCode && preview ? <>Students who enter <strong className="font-mono">{previewCode}</strong> get <strong>{preview}</strong>.</> : <span className="text-black/55">Fill in the code and discount to see what students get.</span>}
      </p>

      <div role="status">{feedback?.tone === "ok" && <p className="mt-3 rounded-xl bg-[#e9f8ee] px-3 py-2 text-sm font-semibold text-[#16803c]">{feedback.text}</p>}</div>
      <div role="alert">{feedback?.tone === "error" && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{feedback.text}</p>}</div>

      <button type="submit" disabled={disabled} className="pk-btn pk-btn-primary mt-4 disabled:opacity-50">{busy ? "Creating…" : "Create code"}</button>
    </form>
  );
}

function PromoCodeCard({ code, editable }: { code: AdminPromoRow; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (busy) return;
    if (code.active && !window.confirm(`Pause ${code.code}? Students won’t be able to apply it until you resume it.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/promo-codes/${encodeURIComponent(code.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !code.active }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The promo code couldn’t be changed.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The promo code couldn’t be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-2xl bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-lg font-black tracking-wider">{code.code}</span><StatusBadge label={code.statusLabel} tone={STATUS_TONES[code.status]} /></p>
          <p className="mt-1 font-bold">{code.offer}</p>
          <p className="mt-0.5 text-sm text-black/65">{code.conditions}</p>
          <p className="mt-0.5 text-sm text-black/65">{code.window}</p>
        </div>
        <button type="button" onClick={() => void toggle()} disabled={!editable || busy} className={`pk-btn pk-btn-sm ${code.active ? "pk-btn-secondary" : "pk-btn-primary"} disabled:opacity-50`}>{busy ? "Saving…" : code.active ? "Pause" : "Resume"}</button>
      </div>
      <p className="mt-3 text-sm font-semibold">{code.usage}</p>
      <p className="mt-1 text-xs text-black/50">{code.createdLabel}</p>
      {error && <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
    </li>
  );
}
