"use client";

import { FormEvent, useState } from "react";
import { formatCoordinates, mapsLink, parseCoordinates, type Coordinates } from "../../lib/delivery-location";
import { Icon } from "../ui/Icon";
import type { DeliveryLocation } from "./LocationSelector";

type LocationFormProps = {
  onSaved: (location: DeliveryLocation) => void;
  onCancel: () => void;
};

type GpsState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "captured"; coordinates: Coordinates; accuracy: number | null }
  | { status: "denied" | "unavailable" | "timeout" | "unsupported" };

const GPS_MESSAGES: Record<"denied" | "unavailable" | "timeout" | "unsupported", string> = {
  denied: "Location access was declined. That’s fine — type your campus location below.",
  unavailable: "We couldn’t get a GPS fix right now. Type your campus location below, or try again outdoors.",
  timeout: "Finding your location took too long. Type your campus location below, or try again.",
  unsupported: "This browser can’t share your location. Type your campus location below.",
};

const LABEL_SUGGESTIONS = ["Hostel", "Faculty", "Main gate", "Library", "Lecture hall"];

export function LocationForm({ onSaved, onCancel }: LocationFormProps) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [gps, setGps] = useState<GpsState>({ status: "idle" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ label?: string; address?: string }>({});

  /** One-off position request, only after the student asks. No watching, nothing sent until they save. */
  function useCurrentLocation() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || !window.isSecureContext) {
      setGps({ status: "unsupported" });
      return;
    }
    setGps({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const parsed = parseCoordinates(position.coords.latitude, position.coords.longitude);
        if (!parsed.ok || !parsed.value) {
          setGps({ status: "unavailable" });
          return;
        }
        setGps({ status: "captured", coordinates: parsed.value, accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null });
      },
      (failure) => setGps({ status: failure.code === 1 ? "denied" : failure.code === 3 ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const errors: { label?: string; address?: string } = {};
    if (!label.trim()) errors.label = "Give this location a short name, e.g. Hostel C.";
    if (!address.trim()) errors.address = "Tell the runner where on campus to come, e.g. hostel and room, faculty building or a landmark.";
    setFieldErrors(errors);
    if (errors.label || errors.address) return;

    try {
      setLoading(true);
      const coordinates = gps.status === "captured" ? gps.coordinates : null;
      const response = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), address: address.trim(), instructions: instructions.trim(), ...(coordinates ?? {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save this location.");
      onSaved(data.location);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save this location.");
    } finally {
      setLoading(false);
    }
  }

  const fieldClass = "w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-base outline-none transition placeholder:text-black/45 focus:border-black focus:shadow-[0_0_0_3px_rgba(254,184,10,0.45)] disabled:opacity-60";

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={loading} aria-labelledby="location-form-heading" className="space-y-5">
      <div>
        <h3 id="location-form-heading" className="text-lg font-black">New delivery location</h3>
        <p className="mt-1 text-sm leading-6 text-black/60">Tell your runner where to bring your order. A written campus location is always needed; GPS is an optional extra.</p>
      </div>

      {/* 1. Optional GPS pin */}
      <div className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
        {gps.status === "captured" ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-black"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#16803c] text-white"><Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /></span> GPS pin added</p>
              <p className="mt-1 font-mono text-xs text-black/65">{formatCoordinates(gps.coordinates)}{gps.accuracy !== null && ` · ±${gps.accuracy} m`}</p>
              {gps.accuracy !== null && gps.accuracy > 100 && <p className="mt-1 text-xs font-semibold text-[#a15c00]">This pin is approximate. Your written location below matters most.</p>}
              <a href={mapsLink(gps.coordinates)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-9 items-center gap-1 text-xs font-bold underline underline-offset-2">Check it on a map <Icon name="arrowRight" className="h-3 w-3" /></a>
            </div>
            <button type="button" onClick={() => setGps({ status: "idle" })} className="min-h-10 rounded-full border border-black/15 px-3 text-xs font-bold hover:bg-black/5">Remove pin</button>
          </div>
        ) : (
          <>
            <button type="button" onClick={useCurrentLocation} disabled={gps.status === "locating" || loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-black bg-white px-4 text-sm font-black transition hover:bg-[#fff4c7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-wait disabled:opacity-70">
              {gps.status === "locating" ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : <Icon name="mapPin" className="h-[18px] w-[18px]" />}
              {gps.status === "locating" ? "Finding your location…" : "Use my current location"}
            </button>
            <p className="mt-2 text-xs leading-5 text-black/55">Optional. Your browser asks first; we read your position once and only save it with this location. We don’t track you.</p>
            {gps.status !== "idle" && gps.status !== "locating" && <p role="status" className="mt-2 rounded-xl bg-[#fff3d6] px-3 py-2 text-xs font-semibold leading-5 text-[#6b4700]">{GPS_MESSAGES[gps.status]}</p>}
          </>
        )}
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      {/* 2. Written campus location (always required) */}
      <div>
        <label htmlFor="location-label" className="mb-1.5 block text-sm font-black">Location name</label>
        <input id="location-label" type="text" value={label} onChange={(event) => setLabel(event.target.value.slice(0, 50))} maxLength={50} placeholder="e.g. Hostel C, Room 12" className={fieldClass} aria-required="true" aria-invalid={Boolean(fieldErrors.label)} aria-describedby={fieldErrors.label ? "location-label-error" : "location-label-hint"} disabled={loading} />
        <div id="location-label-hint" className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick names">
          {LABEL_SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setLabel(suggestion)} disabled={loading} className="min-h-9 rounded-full border border-black/10 bg-white px-3 text-xs font-bold text-black/75 transition hover:border-black/30">{suggestion}</button>
          ))}
        </div>
        {fieldErrors.label && <p id="location-label-error" className="mt-1.5 text-sm font-semibold text-red-700">{fieldErrors.label}</p>}
      </div>

      <div>
        <label htmlFor="location-address" className="mb-1.5 block text-sm font-black">Campus location or landmark</label>
        <textarea id="location-address" value={address} onChange={(event) => setAddress(event.target.value.slice(0, 300))} maxLength={300} rows={2} placeholder="e.g. OOU Main Campus, Hostel C, opposite the chapel" className={`${fieldClass} min-h-20 resize-y`} aria-required="true" aria-invalid={Boolean(fieldErrors.address)} aria-describedby={fieldErrors.address ? "location-address-error" : "location-address-hint"} disabled={loading} />
        <p id="location-address-hint" className="mt-1 text-xs text-black/55">Hostel and room, faculty building, gate, or a nearby landmark the runner can find.</p>
        {fieldErrors.address && <p id="location-address-error" className="mt-1.5 text-sm font-semibold text-red-700">{fieldErrors.address}</p>}
      </div>

      <div>
        <label htmlFor="location-instructions" className="mb-1.5 block text-sm font-black">Usual directions <span className="font-medium text-black/50">(optional)</span></label>
        <textarea id="location-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value.slice(0, 500))} maxLength={500} rows={2} placeholder="e.g. Call me at the gate" className={`${fieldClass} min-h-20 resize-y`} disabled={loading} />
      </div>

      <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
        <button type="button" onClick={onCancel} disabled={loading} className="pk-btn pk-btn-secondary pk-btn-lg sm:flex-1">Cancel</button>
        <button type="submit" disabled={loading} className="pk-btn pk-btn-primary pk-btn-lg disabled:opacity-60 sm:flex-1">{loading ? "Saving…" : "Save and use this location"}</button>
      </div>
    </form>
  );
}
