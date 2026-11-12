"use client";

import { type FormEvent, useEffect, useState } from "react";
import { cashbackEntryLabel, type CashbackKindCode, type CashbackSettingsValue } from "../../lib/cashback/cashback-rules";

type StudentHit = { id: string; name: string; email: string; phone: string | null };
type Entry = { id: string; kind: CashbackKindCode; amount: number; note: string | null; createdAt: string; returned: boolean };
type Selected = { student: { id: string; name: string; email: string }; balance: number; entries: Entry[] };

const naira = (amount: number) => `₦${Math.abs(amount).toLocaleString("en-NG")}`;

/** The earning rules form, and a student lookup with their balance, history and add / take away. */
export function CashbackManager({ initial }: { initial: CashbackSettingsValue }) {
  const [settings, setSettings] = useState(initial);
  const [rate, setRate] = useState(String(initial.ratePercent));
  const [bonus, setBonus] = useState(String(initial.welcomeBonus));
  const [saving, setSaving] = useState(false);
  const [settingsNote, setSettingsNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustNote, setAdjustNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || selected) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/students?${new URLSearchParams({ q })}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json())
        .then((data) => setHits(Array.isArray(data.students) ? data.students : []))
        .catch(() => undefined);
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selected]);

  async function save(event: FormEvent<HTMLFormElement>, enabled = settings.enabled) {
    event.preventDefault();
    setSaving(true); setSettingsNote(null);
    try {
      const response = await fetch("/api/admin/cashback", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, ratePercent: rate, welcomeBonus: bonus || "0" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.settings) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t save that. Try again.");
      setSettings(data.settings);
      setRate(String(data.settings.ratePercent));
      setBonus(String(data.settings.welcomeBonus));
      setSettingsNote({ tone: "ok", text: data.settings.enabled ? "Saved. Delivered orders earn cashback." : "Saved. Cashback earning is off (balances can still be spent)." });
    } catch (error) {
      setSettingsNote({ tone: "error", text: error instanceof Error ? error.message : "We couldn’t save that. Try again." });
    } finally {
      setSaving(false);
    }
  }

  async function open(hit: StudentHit) {
    setLookupError(""); setAdjustNote(null); setHits([]); setQuery("");
    try {
      const response = await fetch(`/api/admin/cashback/students/${encodeURIComponent(hit.id)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t load their cashback.");
      setSelected(data as Selected);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "We couldn’t load their cashback.");
    }
  }

  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || adjusting) return;
    setAdjusting(true); setAdjustNote(null);
    try {
      const response = await fetch(`/api/admin/cashback/students/${encodeURIComponent(selected.student.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, note: reason }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t change their cashback.");
      setAmount(""); setReason("");
      setAdjustNote({ tone: "ok", text: `Done. ${selected.student.name.split(" ")[0]} now has ${naira(data.balance)}.` });
      await open({ id: selected.student.id, name: selected.student.name, email: selected.student.email, phone: null });
    } catch (error) {
      setAdjustNote({ tone: "error", text: error instanceof Error ? error.message : "We couldn’t change their cashback." });
    } finally {
      setAdjusting(false);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <form onSubmit={(event) => void save(event)} className="rounded-2xl bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Earning</h2>
            <p className="text-sm text-black/60">{settings.enabled ? `On: ${settings.ratePercent}% back${settings.welcomeBonus ? `, ${naira(settings.welcomeBonus)} welcome bonus` : ""}.` : "Off: nothing is earned right now."}</p>
          </div>
          <button type="button" onClick={(event) => void save(event as unknown as FormEvent<HTMLFormElement>, !settings.enabled)} disabled={saving} className={`pk-btn pk-btn-sm ${settings.enabled ? "pk-btn-secondary" : "pk-btn-primary"}`}>{settings.enabled ? "Turn off" : "Turn on"}</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">% back on items
            <input type="number" min={0} max={50} step={1} value={rate} onChange={(event) => setRate(event.target.value)} className="pk-input mt-1 min-h-12 w-full" />
          </label>
          <label className="text-sm font-bold">Welcome bonus (₦, 0 for none)
            <input type="number" min={0} max={100000} step={50} value={bonus} onChange={(event) => setBonus(event.target.value)} className="pk-input mt-1 min-h-12 w-full" />
          </label>
        </div>
        <button type="submit" disabled={saving} aria-busy={saving} className="pk-btn pk-btn-secondary mt-3">{saving ? "Saving…" : "Save rules"}</button>
        {settingsNote && <p role={settingsNote.tone === "error" ? "alert" : "status"} className={`mt-3 text-sm font-semibold ${settingsNote.tone === "error" ? "text-red-700" : "text-[#16803c]"}`}>{settingsNote.text}</p>}
      </form>

      <section aria-labelledby="cashback-student" className="rounded-2xl bg-white p-4 sm:p-5">
        <h2 id="cashback-student" className="text-lg font-black">A student’s cashback</h2>
        {!selected ? (
          <>
            <label htmlFor="cashback-search" className="sr-only">Find a student</label>
            <input id="cashback-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email or phone" autoComplete="off" className="pk-input mt-3 min-h-12 w-full" />
            {hits.length > 0 && (
              <ul className="mt-2 divide-y divide-black/5 rounded-2xl border border-black/10">
                {hits.map((hit) => (
                  <li key={hit.id}><button type="button" onClick={() => void open(hit)} className="flex w-full flex-col px-4 py-3 text-left hover:bg-[#fff8df]"><span className="text-sm font-black">{hit.name}</span><span className="text-xs text-black/55">{hit.email}</span></button></li>
                ))}
              </ul>
            )}
            {lookupError && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{lookupError}</p>}
          </>
        ) : (
          <div className="mt-3">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-[#1f1300] p-4 text-white">
              <div className="min-w-0"><p className="truncate font-black">{selected.student.name}</p><p className="truncate text-xs text-white/60">{selected.student.email}</p></div>
              <p className="text-2xl font-black">{naira(selected.balance)}</p>
            </div>
            <form onSubmit={(event) => void adjust(event)} className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
              <label className="text-sm font-bold">Amount (₦)
                <input type="number" step={50} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="500 or -500" className="pk-input mt-1 min-h-12 w-full" />
              </label>
              <label className="text-sm font-bold">Reason (they see it)
                <input value={reason} onChange={(event) => setReason(event.target.value.slice(0, 200))} maxLength={200} placeholder="Sorry your order was late" className="pk-input mt-1 min-h-12 w-full" />
              </label>
              <button type="submit" disabled={adjusting || !amount || !reason.trim()} aria-busy={adjusting} className="pk-btn pk-btn-primary min-h-12">{adjusting ? "Saving…" : "Apply"}</button>
            </form>
            <p className="mt-1 text-xs text-black/50">Use a minus sign to take cashback away. It can’t go below ₦0.</p>
            {adjustNote && <p role={adjustNote.tone === "error" ? "alert" : "status"} className={`mt-2 text-sm font-semibold ${adjustNote.tone === "error" ? "text-red-700" : "text-[#16803c]"}`}>{adjustNote.text}</p>}
            {selected.entries.length > 0 && (
              <ul className="mt-4 divide-y divide-black/5 text-sm">
                {selected.entries.map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0"><span className="block font-semibold">{cashbackEntryLabel(entry.kind, entry.note)}</span><span className="text-xs text-black/50">{new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}{entry.returned ? " · payment didn’t go through" : ""}</span></span>
                    <span className={`shrink-0 font-black ${entry.returned ? "text-black/35 line-through" : entry.amount > 0 ? "text-[#16803c]" : ""}`}>{entry.amount > 0 ? "+" : "−"}{naira(entry.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => { setSelected(null); setAdjustNote(null); }} className="pk-btn pk-btn-ghost pk-btn-sm mt-3">Look up someone else</button>
          </div>
        )}
      </section>
    </div>
  );
}
