"use client";

import { useState } from "react";
import { LocationForm } from "../checkout/LocationForm";

type Address = { id: string; label: string; address: string; instructions: string | null };

/** Saved delivery addresses, managed through the existing locations API. */
export function AddressBook({ initial }: { initial: Address[] }) {
  const [addresses, setAddresses] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function remove(address: Address) {
    if (busyId || !window.confirm(`Remove “${address.label}” from your delivery addresses?`)) return;
    setBusyId(address.id);
    setError("");
    try {
      const response = await fetch(`/api/locations/${encodeURIComponent(address.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That address couldn’t be removed.");
      setAddresses((current) => current.filter((entry) => entry.id !== address.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That address couldn’t be removed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {addresses.length ? (
        <ul className="divide-y divide-black/5">
          {addresses.map((address) => (
            <li key={address.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="text-sm font-extrabold">{address.label}</p>
                <p className="pk-muted mt-0.5 text-sm leading-5">{address.address}</p>
                {address.instructions && <p className="pk-muted mt-0.5 text-xs">{address.instructions}</p>}
              </div>
              <button type="button" onClick={() => void remove(address)} disabled={busyId !== null} className="pk-btn pk-btn-ghost pk-btn-sm shrink-0" aria-label={`Remove ${address.label}`}>
                {busyId === address.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pk-muted text-sm">No saved addresses yet. Add one so checkout is one tap.</p>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>}
      <div className="mt-4">
        {adding ? (
          <LocationForm
            onSaved={(location) => { setAddresses((current) => [location, ...current]); setAdding(false); }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="pk-btn pk-btn-secondary pk-btn-sm">+ Add an address</button>
        )}
      </div>
    </div>
  );
}
