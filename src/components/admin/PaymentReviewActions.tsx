"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CHECK_OUTCOME_DISPLAY, REVIEW_NOTE_MAX, REVIEW_NOTE_MIN, type CheckOutcome } from "../../lib/payments/payment-review-policy";

type Available = { verify: boolean; cancel: "ORDER" | "PRINT_JOB" | null; close: boolean; reopen: boolean; escalate: boolean };
type NoteAction = "close" | "reopen" | "escalate";

const NOTE_COPY: Record<NoteAction, { title: string; explain: string; confirm: string }> = {
  close: {
    title: "Close this review case",
    explain: "Closing records your note and stops this case from being worked on. It does not change the payment: it doesn’t mean money was received, refunded or not received. If the payment is still unresolved it stays listed under “Closed — money still unresolved”.",
    confirm: "Close case",
  },
  reopen: { title: "Reopen this review case", explain: "Reopening puts the case back in the open queue. Say why.", confirm: "Reopen case" },
  escalate: { title: "Escalate / keep unresolved", explain: "The payment stays unresolved and every admin is notified with your note. Use this when OPay can’t confirm the payment and someone needs to follow up (for example with OPay support).", confirm: "Escalate" },
};

const button = "inline-flex min-h-10 items-center justify-center rounded-full px-4 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

export function PaymentReviewActions({ paymentId, available }: { paymentId: string; available: Available }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [noteAction, setNoteAction] = useState<NoteAction | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function send(action: string, extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(action); setMessage(null);
    try {
      const response = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "That action didn’t complete.");
      if (action === "verify" && typeof data.outcome === "string") {
        const display = CHECK_OUTCOME_DISPLAY[data.outcome as CheckOutcome];
        setMessage({ tone: "ok", text: `${display?.label ?? data.outcome}. ${display?.meaning ?? ""} Payment status: ${String(data.paymentStatus).toLowerCase().replaceAll("_", " ")}.` });
      } else {
        setMessage({ tone: "ok", text: typeof data.message === "string" ? data.message : "Saved." });
      }
      setNoteAction(null); setConfirmCancel(false); setNote("");
      router.refresh();
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "That action didn’t complete." });
    } finally {
      setBusy(null);
    }
  }

  const noteLength = note.trim().length;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {available.verify && <button type="button" onClick={() => void send("verify")} disabled={busy !== null} aria-busy={busy === "verify"} className={`${button} bg-black text-white`}>{busy === "verify" ? "Checking with OPay…" : "Retry verification"}</button>}
        {available.cancel && <button type="button" onClick={() => { setNoteAction(null); setConfirmCancel(true); }} disabled={busy !== null} className={`${button} border border-black/15 bg-white`}>{available.cancel === "PRINT_JOB" ? "Cancel print job" : "Cancel unpaid order"}</button>}
        {available.escalate && <button type="button" onClick={() => { setConfirmCancel(false); setNoteAction("escalate"); }} disabled={busy !== null} className={`${button} border border-black/15 bg-white`}>Escalate / keep unresolved</button>}
        {available.close && <button type="button" onClick={() => { setConfirmCancel(false); setNoteAction("close"); }} disabled={busy !== null} className={`${button} border border-black/15 bg-white`}>Close review case</button>}
        {available.reopen && <button type="button" onClick={() => { setConfirmCancel(false); setNoteAction("reopen"); }} disabled={busy !== null} className={`${button} border border-black/15 bg-white`}>Reopen case</button>}
      </div>

      {confirmCancel && available.cancel && (
        <div role="group" aria-label="Confirm cancellation" className="mt-3 rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm">
          <p className="font-black">Cancel the {available.cancel === "PRINT_JOB" ? "print job" : "unpaid order"}?</p>
          <p className="mt-1 leading-6 text-black/70">PackAM checks with OPay first. It only cancels if OPay’s signed record confirms the payment wasn’t completed. If OPay says it was paid, or can’t be reached, nothing changes. No refund is issued and the payment record is kept.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void send("cancel")} disabled={busy !== null} aria-busy={busy === "cancel"} className={`${button} bg-black text-white`}>{busy === "cancel" ? "Checking with OPay…" : "Check and cancel"}</button>
            <button type="button" onClick={() => setConfirmCancel(false)} disabled={busy !== null} className={`${button} border border-black/15 bg-white`}>Keep it</button>
          </div>
        </div>
      )}

      {noteAction && (
        <form className="mt-3 rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm" onSubmit={(event) => { event.preventDefault(); void send(noteAction, { note }); }}>
          <p className="font-black">{NOTE_COPY[noteAction].title}</p>
          <p className="mt-1 leading-6 text-black/70">{NOTE_COPY[noteAction].explain}</p>
          <label htmlFor={`review-note-${paymentId}`} className="mt-3 block text-xs font-black">Resolution note (required)</label>
          <textarea id={`review-note-${paymentId}`} value={note} onChange={(event) => setNote(event.target.value.slice(0, REVIEW_NOTE_MAX))} rows={3} required minLength={REVIEW_NOTE_MIN} maxLength={REVIEW_NOTE_MAX} placeholder="What you checked, what you found, and what happens next." className="mt-1 w-full rounded-xl border border-black/15 bg-white p-3 text-sm" />
          <p className="mt-1 text-xs text-black/50">{noteLength < REVIEW_NOTE_MIN ? `At least ${REVIEW_NOTE_MIN} characters.` : `${noteLength}/${REVIEW_NOTE_MAX}`} Your name and the time are recorded in the audit log.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy !== null || noteLength < REVIEW_NOTE_MIN} aria-busy={busy === noteAction} className={`${button} bg-black text-white`}>{busy === noteAction ? "Saving…" : NOTE_COPY[noteAction].confirm}</button>
            <button type="button" onClick={() => { setNoteAction(null); setNote(""); }} disabled={busy !== null} className={`${button} border border-black/15 bg-white`}>Back</button>
          </div>
        </form>
      )}

      {message && <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-xl p-3 text-xs leading-5 ${message.tone === "error" ? "bg-[#ffe9e7] text-[#c92d24]" : "bg-[#e9f8ee] text-[#16803c]"}`}>{message.text}</p>}
    </div>
  );
}
