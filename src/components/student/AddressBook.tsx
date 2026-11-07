"use client";

import { useState } from "react";

type Address = { id: string; label: string; address: string; instructions: string | null };

/**
 * Places the student has had things delivered to. Delivery now always starts from the phone's live
 * location at checkout, so nothing is added here: the list only lets students remove places they don't
 * want kept.
 */
export function AddressBook({ initial }: { initial: Address[] }) {
  const [addresses, setAddresses] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function remove(address: Address) {
    if (busyId || !window.confirm(`Remove “${address.label}” from your past delivery locations?`)) return;
    setBusyId(address.id);
    setError("");
    try {
      const response = await fetch(`/api/locations/${encodeURIComponent(address.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That location couldn’t be removed.");
      setAddresses((current) => current.filter((entry) => entry.id !== address.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That location couldn’t be removed.");
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
        <p className="pk-muted text-sm">No past delivery locations. There’s nothing to set up: checkout asks for your live location when you order.</p>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>}
    </div>
  );
}
