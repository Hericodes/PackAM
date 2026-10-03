"use client";

import { FormEvent, useState } from "react";

type LocationFormProps = {
  onSaved: (location: { id: string; label: string; address: string; instructions: string | null; latitude: number | null; longitude: number | null }) => void;
  onCancel: () => void;
};

export function LocationForm({
  onSaved,
  onCancel,
}: LocationFormProps) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");

    if (!label.trim()) {
      setError("Give this location a name, e.g. Hostel or Faculty.");
      return;
    }

    if (!address.trim()) {
      setError("Please enter the delivery address.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("/api/locations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: label.trim(),
          address: address.trim(),
          instructions: instructions.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to save this location.",
        );
      }

      onSaved(data.location);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save this location.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[1.75rem] border border-black/5 bg-white p-6"
    >
      <div>
        <h3 className="text-xl font-black">
          Add delivery location
        </h3>

        <p className="mt-2 text-sm leading-6 text-black/50">
          Tell your runner where to bring your order.
        </p>
      </div>

      {error && (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="location-label"
            className="mb-2 block text-sm font-black"
          >
            Location name
          </label>

          <input
            id="location-label"
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. Hostel C"
            className="packam-input"
            disabled={loading}
          />
        </div>

        <div>
          <label
            htmlFor="location-address"
            className="mb-2 block text-sm font-black"
          >
            Address / location
          </label>

          <textarea
            id="location-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="e.g. OOU Main Campus, Hostel C"
            rows={3}
            className="packam-input resize-none"
            disabled={loading}
          />
        </div>

        <div>
          <label
            htmlFor="location-instructions"
            className="mb-2 block text-sm font-black"
          >
            Delivery instructions
            <span className="ml-2 font-medium text-black/40">
              Optional
            </span>
          </label>

          <textarea
            id="location-instructions"
            value={instructions}
            onChange={(event) =>
              setInstructions(event.target.value)
            }
            placeholder="e.g. Call me when you're close."
            rows={3}
            className="packam-input resize-none"
            disabled={loading}
          />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-black px-7 py-3.5 text-sm font-black text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Saving..." : "Save Location"}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-full border border-black/10 bg-white px-7 py-3.5 text-sm font-black transition hover:border-black/20 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
