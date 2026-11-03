"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PAYMENT_PIN_LENGTH } from "../../lib/payments/payment-pin";

const button = "inline-flex min-h-10 items-center justify-center rounded-full px-4 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

/**
 * Confirm or reject one manual bank transfer. Confirming needs the amount the bank app shows (the server refuses
 * anything below the order's amount); the form starts empty so it is never confirmed by habit.
 */
/** The PIN box both forms share: never stored, never autofilled, cleared after every send. */
function PinField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <label htmlFor={id} className="mt-3 block text-xs font-bold">Your payment PIN</label>
      <input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={PAYMENT_PIN_LENGTH} value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))} className="mt-1 min-h-11 w-40 rounded-xl border border-black/15 bg-white px-3 text-base tracking-[0.4em] outline-none focus:border-black" />
    </>
  );
}

export function ManualPaymentActions({ paymentId, amount, pinSet }: { paymentId: string; amount: number; /** The signed-in admin has a payment PIN. */ pinSet: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"confirm" | "reject" | null>(null);
  const [received, setReceived] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function send(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "That didn’t complete.");
      setMessage({ tone: "ok", text: typeof data.message === "string" ? data.message : "Saved." });
      setMode(null);
      setReceived("");
      setNote("");
      router.refresh();
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "That didn’t complete." });
    } finally {
      setPin("");
      setBusy(false);
    }
  }

  const receivedNumber = /^\d+$/.test(received.trim()) ? Number(received.trim()) : NaN;
  const pinReady = pin.length === PAYMENT_PIN_LENGTH;
  if (!pinSet) return <p className="mt-3 rounded-xl bg-[#fff3d6] px-3 py-2 text-xs font-semibold text-[#7a4a00]">Set your payment PIN above to confirm or reject transfers.</p>;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setMessage(null); setMode("confirm"); }} disabled={busy} className={`${button} bg-black text-white`}>Confirm — money received</button>
        <button type="button" onClick={() => { setMessage(null); setMode("reject"); }} disabled={busy} className={`${button} border border-black/15 bg-white`}>Reject — not received</button>
      </div>

      {mode === "confirm" && (
        <form className="mt-3 rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm" onSubmit={(event) => { event.preventDefault(); void send({ action: "confirm", receivedAmount: receivedNumber, pin }); }}>
          <label htmlFor={`received-${paymentId}`} className="font-black">How much does your bank app show? (₦)</label>
          <p className="mt-1 text-xs leading-5 text-black/60">The order is for ₦{amount.toLocaleString()}. Check the credit in your bank app first. Confirming starts the order and sends it to runners.</p>
          <input id={`received-${paymentId}`} inputMode="numeric" autoComplete="off" value={received} onChange={(event) => setReceived(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-base outline-none focus:border-black" placeholder={`e.g. ${amount}`} />
          <PinField id={`pin-confirm-${paymentId}`} value={pin} onChange={setPin} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !Number.isSafeInteger(receivedNumber) || !pinReady} aria-busy={busy} className={`${button} bg-black text-white`}>{busy ? "Confirming…" : "Confirm payment"}</button>
            <button type="button" onClick={() => setMode(null)} disabled={busy} className={`${button} border border-black/15 bg-white`}>Back</button>
          </div>
        </form>
      )}

      {mode === "reject" && (
        <form className="mt-3 rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm" onSubmit={(event) => { event.preventDefault(); void send({ action: "reject", note, pin }); }}>
          <p className="font-black">Reject this payment?</p>
          <p className="mt-1 text-xs leading-5 text-black/60">Use this when the money never arrived. The student is told it didn’t go through and their cart stays. No order is created.</p>
          <label htmlFor={`note-${paymentId}`} className="mt-2 block text-xs font-bold">Note (optional)</label>
          <input id={`note-${paymentId}`} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-base outline-none focus:border-black" placeholder="e.g. No credit from this name by 4pm" />
          <PinField id={`pin-reject-${paymentId}`} value={pin} onChange={setPin} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !pinReady} aria-busy={busy} className={`${button} bg-black text-white`}>{busy ? "Rejecting…" : "Reject payment"}</button>
            <button type="button" onClick={() => setMode(null)} disabled={busy} className={`${button} border border-black/15 bg-white`}>Back</button>
          </div>
        </form>
      )}

      {message && <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${message.tone === "error" ? "bg-[#ffe9e7] text-[#a3241c]" : "bg-[#e8f6ec] text-[#16572b]"}`}>{message.text}</p>}
    </div>
  );
}
