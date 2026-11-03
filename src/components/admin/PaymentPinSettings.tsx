"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PAYMENT_PIN_LENGTH, checkNewPin } from "../../lib/payments/payment-pin";

const button = "inline-flex min-h-10 items-center justify-center rounded-full px-4 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";
const field = "mt-1 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-base outline-none focus:border-black";
const pinField = `${field} max-w-40 tracking-[0.4em]`;
const digits = (value: string) => value.replace(/\D/g, "").slice(0, PAYMENT_PIN_LENGTH);

type OtherAdmin = { id: string; label: string };

/**
 * The signed-in admin's payment PIN: set it (login password needed), change it (password and current PIN), or reset
 * another admin's forgotten PIN with your own. Nothing typed here is kept after a send.
 */
export function PaymentPinSettings({ status, otherAdminsWithPin }: {
  status: { set: false } | { set: true; setAtLabel: string; locked: boolean };
  otherAdminsWithPin: OtherAdmin[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"set" | "reset" | null>(status.set ? null : "set");
  const [password, setPassword] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [repeatPin, setRepeatPin] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function clear() {
    setPassword(""); setCurrentPin(""); setNewPin(""); setRepeatPin("");
  }

  async function send(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/payment-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "That didn’t complete.");
      setMessage({ tone: "ok", text: typeof data.message === "string" ? data.message : "Saved." });
      setOpen(null);
      setTarget("");
      router.refresh();
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "That didn’t complete." });
    } finally {
      clear();
      setBusy(false);
    }
  }

  const rule = checkNewPin(newPin);
  const mismatch = repeatPin.length === PAYMENT_PIN_LENGTH && repeatPin !== newPin;
  const canSet = password.length > 0 && rule.ok && repeatPin === newPin && (!status.set || currentPin.length === PAYMENT_PIN_LENGTH);

  return (
    <section aria-labelledby="payment-pin" className="mt-6 rounded-2xl bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="payment-pin" className="text-lg font-black">Your payment PIN</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-black/60">You type this 6-digit PIN every time you confirm or reject a bank transfer, so someone who gets into your account still can’t approve payments. It’s separate from your login password. 5 wrong tries lock it for 15 minutes and alert every admin.</p>
        </div>
        <p className="text-xs font-bold">
          {status.set ? (status.locked ? <span className="text-[#a3241c]">Locked right now</span> : <span className="text-[#16572b]">Set {status.setAtLabel}</span>) : <span className="text-[#a15c00]">Not set yet</span>}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => { setMessage(null); clear(); setOpen(open === "set" ? null : "set"); }} disabled={busy} className={`${button} bg-black text-white`}>{status.set ? "Change my PIN" : "Set my PIN"}</button>
        {otherAdminsWithPin.length > 0 && status.set && <button type="button" onClick={() => { setMessage(null); clear(); setOpen(open === "reset" ? null : "reset"); }} disabled={busy} className={`${button} border border-black/15 bg-white`}>Reset another admin’s PIN</button>}
      </div>

      {open === "set" && (
        <form className="mt-3 grid max-w-md gap-2 rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm" onSubmit={(event) => { event.preventDefault(); void send({ action: "set", currentPassword: password, newPin, ...(status.set ? { currentPin } : {}) }); }}>
          <label className="text-xs font-bold">Your login password
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={field} />
          </label>
          {status.set && <label className="text-xs font-bold">Current PIN
            <input type="password" inputMode="numeric" autoComplete="off" value={currentPin} onChange={(event) => setCurrentPin(digits(event.target.value))} className={pinField} />
          </label>}
          <label className="text-xs font-bold">New PIN ({PAYMENT_PIN_LENGTH} digits)
            <input type="password" inputMode="numeric" autoComplete="off" value={newPin} onChange={(event) => setNewPin(digits(event.target.value))} className={pinField} aria-describedby="new-pin-rule" />
          </label>
          <p id="new-pin-rule" className="text-xs text-black/55">{newPin.length === PAYMENT_PIN_LENGTH && !rule.ok ? rule.error : "Don’t use your birthday, phone digits, repeated digits or runs like 123456."}</p>
          <label className="text-xs font-bold">New PIN again
            <input type="password" inputMode="numeric" autoComplete="off" value={repeatPin} onChange={(event) => setRepeatPin(digits(event.target.value))} className={pinField} />
          </label>
          {mismatch && <p className="text-xs font-semibold text-[#a3241c]">The two PINs don’t match.</p>}
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !canSet} aria-busy={busy} className={`${button} bg-black text-white`}>{busy ? "Saving…" : status.set ? "Change PIN" : "Set PIN"}</button>
            {status.set && <button type="button" onClick={() => { clear(); setOpen(null); }} disabled={busy} className={`${button} border border-black/15 bg-white`}>Cancel</button>}
          </div>
        </form>
      )}

      {open === "reset" && (
        <form className="mt-3 grid max-w-md gap-2 rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm" onSubmit={(event) => { event.preventDefault(); void send({ action: "reset", targetUserId: target, pin: currentPin }); }}>
          <p className="text-xs leading-5 text-black/60">For an admin who forgot their PIN. Theirs is removed, they’re emailed, and they set a new one with their password.</p>
          <label className="text-xs font-bold">Admin
            <select value={target} onChange={(event) => setTarget(event.target.value)} className={field}>
              <option value="">Choose an admin</option>
              {otherAdminsWithPin.map((admin) => <option key={admin.id} value={admin.id}>{admin.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold">Your payment PIN
            <input type="password" inputMode="numeric" autoComplete="off" value={currentPin} onChange={(event) => setCurrentPin(digits(event.target.value))} className={pinField} />
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !target || currentPin.length !== PAYMENT_PIN_LENGTH} aria-busy={busy} className={`${button} bg-black text-white`}>{busy ? "Resetting…" : "Reset their PIN"}</button>
            <button type="button" onClick={() => { clear(); setOpen(null); }} disabled={busy} className={`${button} border border-black/15 bg-white`}>Cancel</button>
          </div>
        </form>
      )}

      {message && <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${message.tone === "error" ? "bg-[#ffe9e7] text-[#a3241c]" : "bg-[#e8f6ec] text-[#16572b]"}`}>{message.text}</p>}
    </section>
  );
}
