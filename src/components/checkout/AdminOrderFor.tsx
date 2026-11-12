"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DeliveryLocation } from "./LocationSelector";

export type AdminStudent = { id: string; name: string; email: string; phone: string | null; locations: DeliveryLocation[] };
/** Where the order goes: one of the student's saved places, or an address the admin types (saved to their account). */
export type AdminDelivery = { locationId: string; label: string; address: string } | { locationId: null; label: string; address: string };

/**
 * Admin checkout, step 1: who the order is for, and where it goes. Searches active students by name, email or phone;
 * then the student's saved places, or a new written address (hostel, room, landmark). The server checks it all again.
 */
export function AdminOrderFor({ student, onStudent, delivery, onDelivery, disabled }: {
  student: AdminStudent | null;
  onStudent: (student: AdminStudent | null) => void;
  delivery: AdminDelivery | null;
  onDelivery: (delivery: AdminDelivery | null) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminStudent[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (student || q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError("");
      fetch(`/api/admin/students?${new URLSearchParams({ q })}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t search students right now.");
          setResults(Array.isArray(data.students) ? data.students : []);
        })
        .catch((error) => { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : "We couldn’t search students right now."); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, student]);

  function pickStudent(next: AdminStudent) {
    onStudent(next);
    setResults([]);
    setQuery("");
    // Their most recent saved place is a good first guess; the admin can change it.
    const first = next.locations[0];
    setTyping(!first);
    onDelivery(first ? { locationId: first.id, label: first.label, address: first.address } : null);
  }

  function typeAddress(address: string, label: string) {
    setNewAddress(address);
    setNewLabel(label);
    onDelivery(address.trim() ? { locationId: null, label: label.trim(), address: address.trim() } : null);
  }

  if (!student) {
    return (
      <div>
        <label htmlFor="admin-order-student" className="block text-sm font-black">Who is this order for?</label>
        <p className="mt-0.5 text-xs text-black/55">Search by name, email or phone. They pay, and the order shows on their account.</p>
        <input id="admin-order-student" type="search" value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} placeholder="e.g. Ada, ada@oou.edu.ng or 0803…" autoComplete="off" className="pk-input mt-2 min-h-12 w-full" aria-describedby="admin-order-student-status" />
        <p id="admin-order-student-status" className="mt-1.5 min-h-5 text-xs text-black/55" aria-live="polite">
          {searching ? "Searching…" : searchError || (query.trim().length >= 2 && !results.length ? "No student found. They need a PackAM account first." : "")}
        </p>
        {results.length > 0 && (
          <ul className="mt-1 divide-y divide-black/5 rounded-2xl border border-black/10 bg-white">
            {results.map((result) => (
              <li key={result.id}>
                <button type="button" onClick={() => pickStudent(result)} disabled={disabled} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[#fff8df] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black">{result.name}</span>
                    <span className="block truncate text-xs text-black/55">{[result.email, result.phone].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-black/60">Choose</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-2xl bg-[#fff8df] p-3.5">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wider text-[#875a00]">Order for</p>
          <p className="mt-0.5 truncate font-black">{student.name}</p>
          <p className="truncate text-xs text-black/60">{[student.email, student.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" onClick={() => { onStudent(null); onDelivery(null); }} disabled={disabled} className="pk-btn pk-btn-ghost pk-btn-sm shrink-0">Change</button>
      </div>

      <fieldset>
        <legend className="text-sm font-black">Deliver to</legend>
        <div className="mt-2 grid gap-2">
          {student.locations.map((location) => (
            <label key={location.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition ${!typing && delivery?.locationId === location.id ? "border-black bg-white" : "border-black/10 bg-white/60 hover:border-black/25"}`}>
              <input type="radio" name="admin-order-place" checked={!typing && delivery?.locationId === location.id} onChange={() => { setTyping(false); onDelivery({ locationId: location.id, label: location.label, address: location.address }); }} disabled={disabled} className="mt-1" />
              <span className="min-w-0">
                <span className="block font-black">{location.label}</span>
                <span className="block break-words text-black/65">{location.address}</span>
              </span>
            </label>
          ))}
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition ${typing ? "border-black bg-white" : "border-black/10 bg-white/60 hover:border-black/25"}`}>
            <input type="radio" name="admin-order-place" checked={typing} onChange={() => { setTyping(true); typeAddress(newAddress, newLabel); }} disabled={disabled} className="mt-1" />
            <span className="font-black">{student.locations.length ? "A different address" : "Where should we deliver?"}</span>
          </label>
        </div>
        {typing && (
          <div className="mt-3 grid gap-3">
            <div>
              <label htmlFor="admin-order-address" className="block text-sm font-bold">Address on campus</label>
              <input id="admin-order-address" value={newAddress} onChange={(event) => typeAddress(event.target.value.slice(0, 300), newLabel)} disabled={disabled} maxLength={300} placeholder="e.g. Block C, Room 12, Female Hostel" className="pk-input mt-1 min-h-12 w-full" />
            </div>
            <div>
              <label htmlFor="admin-order-label" className="block text-sm font-bold">Name for this place <span className="font-medium text-black/50">(optional)</span></label>
              <input id="admin-order-label" value={newLabel} onChange={(event) => typeAddress(newAddress, event.target.value.slice(0, 50))} disabled={disabled} maxLength={50} placeholder="e.g. Hostel" className="pk-input mt-1 min-h-12 w-full" />
            </div>
            <p className="text-xs text-black/55">Only on OOU main campus. It’s saved to the student’s account so the runner can find it.</p>
          </div>
        )}
      </fieldset>
    </div>
  );
}

export type PlacedOrder = {
  reference: string;
  amount: number;
  student: { id: string; name: string; phone: string | null };
  payment: { kind: "transfer"; code: string; bankName: string; accountNumber: string; accountName: string } | { kind: "link"; url: string };
};

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

/** "0803 123 4567" → "2348031234567" for a WhatsApp link; null when it doesn't look like a Nigerian mobile number. */
export function whatsappNumber(phone: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return digits;
  return null;
}

export function paymentMessage(placed: PlacedOrder) {
  const first = placed.student.name.split(" ")[0];
  return placed.payment.kind === "transfer"
    ? `Hi ${first}, your PackAM order is ready. Please send ${naira(placed.amount)} to ${placed.payment.bankName} ${placed.payment.accountNumber} (${placed.payment.accountName}) and put ${placed.payment.code} in the remark. We’ll start your order as soon as it lands. Thank you!`
    : `Hi ${first}, your PackAM order is ready. Pay ${naira(placed.amount)} here to start it: ${placed.payment.url}`;
}

/** After placing: what to send the student, and where to confirm the money. */
export function AdminOrderPlaced({ placed, browseHref }: { placed: PlacedOrder; browseHref: string }) {
  const [copied, setCopied] = useState(false);
  const message = paymentMessage(placed);
  const whatsapp = whatsappNumber(placed.student.phone);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="admin-order-placed" className="pk-card mx-auto max-w-xl p-5 sm:p-7">
      <p className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e9f8ee] text-2xl" aria-hidden="true">✓</p>
      <h2 id="admin-order-placed" className="mt-3 text-2xl font-black">Order placed for {placed.student.name}</h2>
      <p className="mt-1 text-sm leading-6 text-black/65">It starts as soon as {placed.student.name.split(" ")[0]} pays. They’ve been notified on PackAM too.</p>

      {placed.payment.kind === "transfer" ? (
        <dl className="mt-5 grid gap-2 rounded-2xl bg-[#fff8df] p-4 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-black/60">Amount</dt><dd className="font-black">{naira(placed.amount)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-black/60">Bank</dt><dd className="font-bold">{placed.payment.bankName}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-black/60">Account</dt><dd className="font-mono font-bold">{placed.payment.accountNumber}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-black/60">Name</dt><dd className="text-right font-bold">{placed.payment.accountName}</dd></div>
          <div className="flex items-center justify-between gap-3 border-t border-black/10 pt-2"><dt className="text-black/60">Code for the remark</dt><dd className="font-mono text-lg font-black tracking-widest">{placed.payment.code}</dd></div>
        </dl>
      ) : (
        <p className="mt-5 break-all rounded-2xl bg-[#fff8df] p-4 text-sm"><span className="font-black">Payment link:</span> {placed.payment.url}</p>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => void copy()} className="pk-btn pk-btn-primary">{copied ? "Copied ✓" : "Copy message for them"}</button>
        {whatsapp
          ? <a href={`https://wa.me/${whatsapp}?${new URLSearchParams({ text: message })}`} target="_blank" rel="noopener noreferrer" className="pk-btn pk-btn-secondary">Send on WhatsApp</a>
          : <span className="pk-btn pk-btn-secondary pointer-events-none opacity-50">No phone number</span>}
      </div>
      {placed.payment.kind === "transfer" && (
        <p className="mt-4 text-sm leading-6 text-black/65">When the money lands, confirm it on <Link href="/admin/payments" className="font-bold text-black underline underline-offset-4">Payments</Link> with your payment PIN. The order then goes to runners.</p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={browseHref} className="pk-btn pk-btn-secondary pk-btn-sm">Place another order</Link>
        <Link href="/admin/orders" className="pk-btn pk-btn-ghost pk-btn-sm">Admin orders</Link>
      </div>
    </section>
  );
}
