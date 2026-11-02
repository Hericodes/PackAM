"use client";

import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "../ui/StatusBadge";
import { formatNaira } from "../../lib/products/product-form";
import { MAX_DELIVERY_TIER_FEE } from "../../lib/delivery-tiers";
import { parseTierFeeDraft, turnOffConfirmation, type AdminTierCard } from "../../lib/delivery-tier-admin-input";

type Feedback = { tone: "ok" | "error"; text: string };

const SAVE_FAILED = "The delivery prices couldn’t be saved. Nothing was changed — try again.";

/**
 * Admin → Delivery tiers: one card per tier with its fee and on/off switch; the delivery window and description are
 * shown read-only. The server checks everything again and audits each change. `version` always comes from the props
 * (never state), so a save made against values someone has since changed is refused instead of overwriting them.
 * `editable` false (before the tier migration) disables every field and button.
 */
export function DeliveryTierSettings({ editable, tiers }: { editable: boolean; tiers: AdminTierCard[] }) {
  return <div className="mt-6 grid gap-4">{tiers.map((card) => <TierCard key={card.tier} card={card} editable={editable} />)}</div>;
}

/** Keyed by tier only, so a save's result stays on screen while the refreshed values replace the form below it. */
function TierCard({ card, editable }: { card: AdminTierCard; editable: boolean }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const titleId = `tier-${card.tier}-title`;
  return (
    <section aria-labelledby={titleId} className="rounded-2xl bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-black">{card.label}</h2>
          <p className="mt-0.5 text-sm"><strong>{card.fee === null ? "No fee set" : formatNaira(card.fee)}</strong> <span className="text-black/60">· Estimated delivery {card.eta}</span></p>
        </div>
        <StatusBadge label={card.enabled ? "Enabled" : "Disabled"} tone={card.enabled ? "success" : "neutral"} />
      </div>
      <p className="mt-2 text-sm text-black/65">{card.description}</p>

      {/* A new version (after any save, here or elsewhere) starts a fresh form with the saved values. */}
      <TierForm key={`${card.tier}:${card.version}`} card={card} editable={editable && card.version !== null} onFeedback={setFeedback} />

      {/* Both live regions stay mounted, so a save's result is announced when it appears. */}
      <div role="status">{feedback?.tone === "ok" && <p className="mt-3 rounded-xl bg-[#e9f8ee] px-3 py-2 text-sm font-semibold text-[#16803c]">{feedback.text}</p>}</div>
      <div role="alert">{feedback?.tone === "error" && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{feedback.text}</p>}</div>
      <p className="mt-3 text-xs text-black/50">
        {card.updatedAtLabel ? `Last changed ${card.updatedAtLabel}` : editable ? "This speed has no settings row in the database, so it can’t be changed here." : "Can be changed after the database update."}
      </p>
    </section>
  );
}

function TierForm({ card, editable, onFeedback }: { card: AdminTierCard; editable: boolean; onFeedback: (feedback: Feedback | null) => void }) {
  const router = useRouter();
  const [fee, setFee] = useState(card.fee === null ? "" : String(card.fee));
  const [enabled, setEnabled] = useState(card.enabled);
  const [feeError, setFeeError] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const feeId = `tier-fee-${card.tier}`;
  const disabled = !editable || busy;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || card.version === null || sending.current) return;
    const draft = parseTierFeeDraft(fee, enabled, card.tier);
    if (!draft.ok) {
      setFeeError(draft.error);
      onFeedback(null);
      return;
    }
    setFeeError("");
    if (draft.fee === card.fee && enabled === card.enabled) return onFeedback({ tone: "ok", text: "No changes to save." });
    if (card.enabled && !enabled && !window.confirm(turnOffConfirmation(card.tier))) return;

    sending.current = true; setBusy(true); onFeedback(null);
    try {
      const response = await fetch("/api/admin/delivery-tiers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: card.tier, version: card.version, fee: draft.fee, enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        onFeedback({ tone: "ok", text: data.changed === false ? "No changes to save." : "Saved. New checkouts use this now." });
        router.refresh();
        return;
      }
      onFeedback({ tone: "error", text: typeof data.error === "string" ? data.error : SAVE_FAILED });
      // Someone changed the tier (or it is gone, or the database isn't ready): show what is true now.
      if (response.status === 404 || response.status === 409 || response.status === 503) router.refresh();
    } catch (cause) {
      onFeedback({ tone: "error", text: cause instanceof TypeError ? "No connection. Nothing was changed — try again." : SAVE_FAILED });
    } finally {
      sending.current = false; setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="mt-4 grid gap-3 border-t border-black/5 pt-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:items-start">
      <div>
        <label htmlFor={feeId} className="mb-1.5 block text-sm font-black">Delivery fee</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-black text-black/55" aria-hidden="true">₦</span>
          <input
            id={feeId}
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            aria-invalid={feeError ? true : undefined}
            aria-describedby={feeError ? `${feeId}-error` : `${feeId}-hint`}
            className="pk-input pl-9"
          />
        </div>
        {feeError
          ? <p id={`${feeId}-error`} role="alert" className="mt-1.5 text-xs font-semibold text-red-700">{feeError}</p>
          : <p id={`${feeId}-hint`} className="mt-1.5 text-xs text-black/50">Whole naira, ₦1 to {formatNaira(MAX_DELIVERY_TIER_FEE)}.</p>}
      </div>
      <label className="flex min-h-12 items-center gap-2.5 text-sm font-bold sm:mt-7">
        <input type="checkbox" id={`tier-enabled-${card.tier}`} checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={disabled} className="h-5 w-5 shrink-0 accent-black" />
        Enabled (offered at checkout)
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={disabled} className="pk-btn pk-btn-primary">{busy ? "Saving…" : <>Save<span className="sr-only"> {card.label}</span></>}</button>
      </div>
    </form>
  );
}
