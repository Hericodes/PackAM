"use client";

import { FormEvent, useId, useMemo, useRef, useState } from "react";
import { formatCoordinates, mapsLink, type Coordinates } from "../../lib/delivery-location";
import { isCoarse } from "../../lib/geolocation";
import { CAMPUS_KIND_LABELS, LOCATION_LABEL_MAX, campusPlaceAddress, deriveLocationLabel, matchCampusPlaces } from "../../lib/location-choice";
import { CAMPUS_PLACES, type CampusPlace } from "../../config/campus-places";
import { SERVICE_AREA } from "../../config/service-area";
import { Icon } from "../ui/Icon";
import type { DeliveryLocation } from "./LocationSelector";

type LocationFormProps = {
  onSaved: (location: DeliveryLocation) => void;
  onCancel: () => void;
  /** Campus suggestions; defaults to the operations-maintained list. */
  places?: CampusPlace[];
  /** The live pin from this phone, already checked to be on campus. Shown read-only and saved with the location. */
  pin?: { coordinates: Coordinates; accuracy: number | null };
  /** Typed by hand (live location failed): the student must confirm the location is on campus. */
  confirmOnCampus?: boolean;
  title?: string;
  intro?: string;
  submitLabel?: string;
  cancelLabel?: string;
};

const LABEL_SUGGESTIONS = ["Hostel", "Faculty", "Main gate", "Library", "Lecture hall"];
const DIRECTION_SUGGESTIONS = ["Meet me at the hostel gate", "Call me when you arrive", "I’m on the ground floor"];

/** The written part of a delivery location: where on campus, an optional name and directions, plus any live pin. */
export function LocationForm({ onSaved, onCancel, places = CAMPUS_PLACES, pin, confirmOnCampus = false, title = "New delivery location", intro, submitLabel = "Save and use this location", cancelLabel = "Cancel" }: LocationFormProps) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [onCampus, setOnCampus] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [addressError, setAddressError] = useState("");
  const [campusError, setCampusError] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const campusRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const suggestions = useMemo(() => (showSuggestions ? matchCampusPlaces(address, places) : []), [address, places, showSuggestions]);
  const derivedLabel = address.trim() ? deriveLocationLabel(address) : "";

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
    if (confirmOnCampus && !onCampus) {
      setCampusError(`PackAM only delivers on ${SERVICE_AREA.placeLabel}. Tick the box to confirm this location is on campus.`);
      campusRef.current?.focus();
      return;
    }
    setCampusError("");
    try {
      setLoading(true);
      const response = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: (label.trim() || derivedLabel).slice(0, LOCATION_LABEL_MAX), address: address.trim(), instructions: instructions.trim(), ...(pin?.coordinates ?? {}) }),
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
        <h3 id="location-form-heading" className="text-lg font-black">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-black/60">{intro ?? "Type where you are on campus — that’s all your runner needs."}</p>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      {/* The live pin from this phone (read-only) */}
      {pin && (
        <div className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
          <p className="flex items-center gap-2 text-sm font-black"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#16803c] text-white"><Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /></span> Live location from this phone</p>
          <p className="mt-1 font-mono text-xs text-black/65">{formatCoordinates(pin.coordinates)}{pin.accuracy !== null && ` · ±${pin.accuracy} m`}</p>
          {isCoarse(pin.accuracy) && <p className="mt-1 text-xs font-semibold text-[#a15c00]">This pin is approximate. Your written spot below matters most.</p>}
          <a href={mapsLink(pin.coordinates)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-9 items-center gap-1 text-xs font-bold underline underline-offset-2">Check it’s right on a map <Icon name="arrowRight" className="h-3 w-3" /></a>
        </div>
      )}

      {/* 1. Written campus location: always required */}
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

      {/* 2. Typed by hand: confirm it is on campus */}
      {confirmOnCampus && (
        <div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-black/10 bg-[#fffdf7] p-3.5 text-sm">
            <input ref={campusRef} type="checkbox" checked={onCampus} onChange={(event) => { setOnCampus(event.target.checked); if (event.target.checked) setCampusError(""); }} disabled={loading} aria-invalid={Boolean(campusError)} aria-describedby={campusError ? "location-campus-error" : undefined} className="mt-0.5 h-5 w-5 shrink-0 accent-black" />
            <span><span className="font-black">This location is on {SERVICE_AREA.placeLabel}</span><span className="mt-0.5 block text-xs leading-5 text-black/60">PackAM only delivers on campus. Runners can’t deliver to off-campus hostels or other towns.</span></span>
          </label>
          {campusError && <p id="location-campus-error" className="mt-1.5 text-sm font-semibold text-red-700">{campusError}</p>}
        </div>
      )}

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
        <button type="button" onClick={onCancel} disabled={loading} className="pk-btn pk-btn-secondary pk-btn-lg sm:flex-1">{cancelLabel}</button>
        <button type="submit" disabled={loading} className="pk-btn pk-btn-primary pk-btn-lg disabled:opacity-60 sm:flex-1">{loading ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
