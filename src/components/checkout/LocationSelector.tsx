"use client";

import { useState } from "react";
import { mapsLink } from "../../lib/delivery-location";
import { Icon } from "../ui/Icon";
import { LocationForm } from "./LocationForm";

export type DeliveryLocation = {
  id: string;
  label: string;
  address: string;
  instructions: string | null;
  latitude: number | null;
  longitude: number | null;
};

type LocationSelectorProps = {
  locations: DeliveryLocation[];
  selectedLocation: DeliveryLocation | null;
  onSelect: (location: DeliveryLocation) => void;
  /** Draw its own card and heading (default). Checkout turns this off because it supplies its own step card. */
  framed?: boolean;
};

export const hasPin = (location: DeliveryLocation) => location.latitude !== null && location.longitude !== null;

function GpsBadge() {
  return <span className="inline-flex items-center gap-1 rounded-full bg-[#e9f8ee] px-2 py-0.5 text-[0.6875rem] font-bold text-[#16803c]"><Icon name="mapPin" className="h-3 w-3" strokeWidth={2.4} /> GPS pin</span>;
}

/** Saved locations to pick from, plus an inline form to add one (manual entry, optional GPS). */
export function LocationSelector({ framed = true, ...props }: LocationSelectorProps) {
  if (!framed) return <LocationChooser {...props} />;
  return (
    <section aria-labelledby="location-selector-heading" className="rounded-[1.5rem] border border-black/5 bg-white p-4 sm:p-5">
      <h2 id="location-selector-heading" className="mb-3 flex items-center gap-2 text-sm font-black"><Icon name="mapPin" className="h-4 w-4 text-[#875a00]" /> Deliver to</h2>
      <LocationChooser {...props} />
    </section>
  );
}

function LocationChooser({ locations: savedLocations, selectedLocation, onSelect }: Omit<LocationSelectorProps, "framed">) {
  const [locations, setLocations] = useState(savedLocations);
  const [showChoices, setShowChoices] = useState(false);
  const [showForm, setShowForm] = useState(savedLocations.length === 0);

  if (showForm) {
    return (
      <LocationForm
        onSaved={(location) => {
          setLocations((current) => [location, ...current]);
          onSelect(location);
          setShowForm(false);
          setShowChoices(false);
        }}
        onCancel={() => setShowForm(false)}
      />
    );
  }

  return (
    <div>
      {selectedLocation ? (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-black bg-[#fffdf7] p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#feb80a]"><Icon name="mapPin" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 break-words font-black">{selectedLocation.label}{hasPin(selectedLocation) && <GpsBadge />}</p>
            <p className="mt-0.5 break-words text-sm leading-5 text-black/65">{selectedLocation.address}</p>
            {hasPin(selectedLocation) && (
              <a href={mapsLink({ latitude: selectedLocation.latitude!, longitude: selectedLocation.longitude! })} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-9 items-center gap-1 text-xs font-bold underline underline-offset-2">Check pin on a map <Icon name="arrowRight" className="h-3 w-3" /></a>
            )}
          </div>
          <button type="button" onClick={() => setShowChoices((current) => !current)} aria-expanded={showChoices} aria-controls="saved-location-choices" className="min-h-11 shrink-0 rounded-full border border-black/15 bg-white px-4 text-sm font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
            {showChoices ? "Done" : "Change"}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-black/20 p-4 text-sm">
          <p className="font-black">No delivery location chosen yet</p>
          <p className="mt-0.5 text-black/60">Pick a saved location or add a new one.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {locations.length > 0 && <button type="button" onClick={() => setShowChoices(true)} aria-expanded={showChoices} aria-controls="saved-location-choices" className="pk-btn pk-btn-secondary pk-btn-sm">Choose saved</button>}
            <button type="button" onClick={() => setShowForm(true)} className="pk-btn pk-btn-primary pk-btn-sm">Add a location</button>
          </div>
        </div>
      )}

      <div id="saved-location-choices" hidden={!showChoices} className="mt-3 space-y-2" role="group" aria-label="Saved delivery locations">
        {locations.map((location) => {
          const selected = selectedLocation?.id === location.id;
          return (
            <button key={location.id} type="button" onClick={() => { onSelect(location); setShowChoices(false); }} aria-pressed={selected} className={`flex min-h-14 w-full items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${selected ? "border-black bg-[#fff4c7]" : "border-black/10 bg-white hover:border-black/25"}`}>
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-black bg-black text-[#feb80a]" : "border-black/25"}`} aria-hidden="true">{selected && <Icon name="check" className="h-3 w-3" strokeWidth={3.2} />}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-black">{location.label}{hasPin(location) && <GpsBadge />}</span>
                <span className="mt-0.5 block break-words text-sm text-black/60">{location.address}</span>
              </span>
            </button>
          );
        })}
        <button type="button" onClick={() => setShowForm(true)} className="flex min-h-12 w-full items-center gap-2 rounded-xl border border-dashed border-black/25 px-4 text-left text-sm font-black transition hover:bg-black/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
          <Icon name="plus" className="h-4 w-4" strokeWidth={2.6} /> Add a new location
        </button>
      </div>
    </div>
  );
}
