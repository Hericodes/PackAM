"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { formatCoordinates, mapsLink, type Coordinates } from "../../lib/delivery-location";
import { FAST_FIX, PRECISE_FIX, isCoarse, requestPosition, type GeoFailure } from "../../lib/geolocation";
import { CAMPUS_KIND_LABELS, LOCATION_LABEL_MAX, campusPlaceAddress, deriveLocationLabel, matchCampusPlaces } from "../../lib/location-choice";
import { CAMPUS_PLACES, type CampusPlace } from "../../config/campus-places";
import { Icon } from "../ui/Icon";
import type { DeliveryLocation } from "./LocationSelector";

type LocationFormProps = {
  onSaved: (location: DeliveryLocation) => void;
  onCancel: () => void;
  /** Campus suggestions; defaults to the operations-maintained list. */
  places?: CampusPlace[];
};

type GpsState =
  | { status: "idle" }
  | { status: "locating"; precise: boolean }
  | { status: "captured"; coordinates: Coordinates; accuracy: number | null }
  | { status: Exclude<GeoFailure, "cancelled"> };

const GPS_MESSAGES: Record<Exclude<GeoFailure, "cancelled">, string> = {
  denied: "Location access was declined. No wahala — just type where you are above.",
  unavailable: "We couldn’t get a position right now. Type where you are above — that’s all a runner needs.",
  timeout: "Finding your position took too long. Type where you are above, or try again.",
  unsupported: "This browser can’t share your location. Type where you are above.",
};

const LABEL_SUGGESTIONS = ["Hostel", "Faculty", "Main gate", "Library", "Lecture hall"];
const DIRECTION_SUGGESTIONS = ["Meet me at the hostel gate", "Call me when you arrive", "I’m on the ground floor"];

export function LocationForm({ onSaved, onCancel, places = CAMPUS_PLACES }: LocationFormProps) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [gps, setGps] = useState<GpsState>({ status: "idle" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [addressError, setAddressError] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const cancelGps = useRef<(() => void) | null>(null);
  const listId = useId();

  useEffect(() => () => cancelGps.current?.(), []);

  const suggestions = useMemo(() => (showSuggestions ? matchCampusPlaces(address, places) : []), [address, places, showSuggestions]);
  const derivedLabel = address.trim() ? deriveLocationLabel(address) : "";

  /** One-off position request, only after the student asks. No watching, nothing sent until they save. */
  async function locate(precise: boolean) {
    cancelGps.current?.();
    setGps({ status: "locating", precise });
    const request = requestPosition(
      { geolocation: typeof navigator !== "undefined" && "geolocation" in navigator ? navigator.geolocation : undefined, secureContext: typeof window !== "undefined" && window.isSecureContext },
      precise ? PRECISE_FIX : FAST_FIX,
    );
    cancelGps.current = request.cancel;
    const result = await request.result;
    if (cancelGps.current === request.cancel) cancelGps.current = null;
    if (result.ok) {
      setGps({ status: "captured", coordinates: result.coordinates, accuracy: result.accuracy });
    } else if (result.reason === "cancelled") {
      setGps((current) => (current.status === "locating" ? { status: "idle" } : current));
    } else {
      setGps({ status: result.reason });
      // The written location is the fallback, so put the student straight there.
      addressRef.current?.focus();
    }
  }

  function choosePlace(place: CampusPlace) {
    setAddress(campusPlaceAddress(place));
    if (!label.trim()) setLabel(place.name.slice(0, LOCATION_LABEL_MAX));
    setShowSuggestions(false);
    setAddressError("");
    addressRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    if (!address.trim()) {
      setAddressError("Tell the runner where on campus to come, e.g. hostel and room, faculty building or a landmark.");
      addressRef.current?.focus();
      return;
    }
    setAddressError("");
    try {
      setLoading(true);
      const coordinates = gps.status === "captured" ? gps.coordinates : null;
      const response = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: (label.trim() || derivedLabel).slice(0, LOCATION_LABEL_MAX), address: address.trim(), instructions: instructions.trim(), ...(coordinates ?? {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to save this location.");
      onSaved(data.location);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save this location.");
    } finally {
      setLoading(false);
    }
  }

  const fieldClass = "w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-base outline-none transition placeholder:text-black/45 focus:border-black focus:shadow-[0_0_0_3px_rgba(254,184,10,0.45)] disabled:opacity-60";
  const chip = "min-h-9 rounded-full border border-black/10 bg-white px-3 text-xs font-bold text-black/75 transition hover:border-black/30 disabled:opacity-50";

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={loading} aria-labelledby="location-form-heading" className="space-y-5">
      <div>
        <h3 id="location-form-heading" className="text-lg font-black">New delivery location</h3>
        <p className="mt-1 text-sm leading-6 text-black/60">Type where you are on campus — that’s all your runner needs. A GPS pin is an optional extra.</p>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      {/* 1. Written campus location: the only required field */}
      <div className="relative">
        <label htmlFor="location-address" className="mb-1.5 block text-sm font-black">Where on campus?</label>
        <textarea
          id="location-address"
          ref={addressRef}
          value={address}
          onChange={(event) => { setAddress(event.target.value.slice(0, 300)); setShowSuggestions(true); if (addressError) setAddressError(""); }}
          onKeyDown={(event) => { if (event.key === "Escape") setShowSuggestions(false); }}
          maxLength={300}
          rows={2}
          placeholder="e.g. Hostel C, Room 12, opposite the chapel"
          className={`${fieldClass} min-h-20 resize-y`}
          aria-required="true"
          aria-invalid={Boolean(addressError)}
          aria-describedby={addressError ? "location-address-error" : "location-address-hint"}
          aria-controls={suggestions.length ? listId : undefined}
          aria-autocomplete={places.length ? "list" : undefined}
          disabled={loading}
        />
        {suggestions.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Campus places" className="mt-1 overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
            {suggestions.map((place) => (
              <li key={`${place.name}-${place.area ?? ""}`} role="option" aria-selected="false">
                <button type="button" onClick={() => choosePlace(place)} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-[#fff4c7] focus-visible:bg-[#fff4c7] focus-visible:outline-none">
                  <span className="min-w-0"><span className="block truncate font-bold">{place.name}</span><span className="block truncate text-xs text-black/55">{CAMPUS_KIND_LABELS[place.kind]}{place.area ? ` · ${place.area}` : ""}</span></span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${place.verified ? "bg-[#e9f8ee] text-[#16803c]" : "bg-black/5 text-black/55"}`}>{place.verified ? "Verified spot" : "Suggested"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p id="location-address-hint" className="mt-1 text-xs text-black/55">Hostel and room, faculty building, gate, or a landmark the runner can find.</p>
        {addressError && <p id="location-address-error" className="mt-1.5 text-sm font-semibold text-red-700">{addressError}</p>}
      </div>

      {/* 2. Optional GPS pin */}
      <div className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
        {gps.status === "captured" ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-black"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#16803c] text-white"><Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /></span> GPS pin from this phone added</p>
              <p className="mt-1 font-mono text-xs text-black/65">{formatCoordinates(gps.coordinates)}{gps.accuracy !== null && ` · ±${gps.accuracy} m`}</p>
              {isCoarse(gps.accuracy) && <p className="mt-1 text-xs font-semibold text-[#a15c00]">This pin is approximate. Your written location matters most.</p>}
              <a href={mapsLink(gps.coordinates)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-9 items-center gap-1 text-xs font-bold underline underline-offset-2">Check it on a map <Icon name="arrowRight" className="h-3 w-3" /></a>
            </div>
            <div className="flex flex-wrap gap-2">
              {isCoarse(gps.accuracy) && <button type="button" onClick={() => void locate(true)} disabled={loading} className="min-h-10 rounded-full border border-black/15 px-3 text-xs font-bold hover:bg-black/5">Get a more precise pin</button>}
              <button type="button" onClick={() => setGps({ status: "idle" })} disabled={loading} className="min-h-10 rounded-full border border-black/15 px-3 text-xs font-bold hover:bg-black/5">Remove pin</button>
            </div>
          </div>
        ) : gps.status === "locating" ? (
          <div className="flex flex-wrap items-center justify-between gap-3" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-black"><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" /> {gps.precise ? "Getting a more precise pin…" : "Finding your location…"}</p>
            <button type="button" onClick={() => cancelGps.current?.()} className="min-h-10 rounded-full border border-black/15 bg-white px-4 text-xs font-bold hover:bg-black/5">Stop</button>
            <p className="w-full text-xs text-black/55">You can keep typing your location while this runs.</p>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => void locate(false)} disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-black bg-white px-4 text-sm font-black transition hover:bg-[#fff4c7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-70">
              <Icon name="mapPin" className="h-[18px] w-[18px]" /> Use my current location
            </button>
            <p className="mt-2 text-xs leading-5 text-black/55">Optional. Your browser asks first; we read your position once and only save it with this location. We don’t track you.</p>
            {gps.status !== "idle" && <p role="status" className="mt-2 rounded-xl bg-[#fff3d6] px-3 py-2 text-xs font-semibold leading-5 text-[#6b4700]">{GPS_MESSAGES[gps.status]}</p>}
          </>
        )}
      </div>

      {/* 3. Optional short name */}
      <div>
        <label htmlFor="location-label" className="mb-1.5 block text-sm font-black">Name for this location <span className="font-medium text-black/50">(optional)</span></label>
        <input id="location-label" type="text" value={label} onChange={(event) => setLabel(event.target.value.slice(0, LOCATION_LABEL_MAX))} maxLength={LOCATION_LABEL_MAX} placeholder={derivedLabel ? `We’ll call it “${derivedLabel}”` : "e.g. My hostel"} className={fieldClass} disabled={loading} aria-describedby="location-label-hint" />
        <div id="location-label-hint" className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick names">
          {LABEL_SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => setLabel(suggestion)} disabled={loading} className={chip}>{suggestion}</button>)}
        </div>
      </div>

      {/* 4. Optional directions */}
      <div>
        <label htmlFor="location-instructions" className="mb-1.5 block text-sm font-black">Usual directions <span className="font-medium text-black/50">(optional)</span></label>
        <textarea id="location-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value.slice(0, 500))} maxLength={500} rows={2} placeholder="e.g. Meet me at the hostel gate" className={`${fieldClass} min-h-20 resize-y`} disabled={loading} />
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick directions">
          {DIRECTION_SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" disabled={loading} className={chip} onClick={() => setInstructions((current) => (current.includes(suggestion) ? current : `${current.trim() ? `${current.trim()}. ` : ""}${suggestion}`).slice(0, 500))}>{suggestion}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
        <button type="button" onClick={onCancel} disabled={loading} className="pk-btn pk-btn-secondary pk-btn-lg sm:flex-1">Cancel</button>
        <button type="submit" disabled={loading} className="pk-btn pk-btn-primary pk-btn-lg disabled:opacity-60 sm:flex-1">{loading ? "Saving…" : "Save and use this location"}</button>
      </div>
    </form>
  );
}
