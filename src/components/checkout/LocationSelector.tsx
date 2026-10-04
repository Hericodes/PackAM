"use client";

import { useState } from "react";
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
};

export function LocationSelector({ locations: savedLocations, selectedLocation, onSelect }: LocationSelectorProps) {
  const [locations, setLocations] = useState(savedLocations);
  const [showChoices, setShowChoices] = useState(false);
  const [showForm, setShowForm] = useState(false);

  if (showForm) {
    return <LocationForm onSaved={(location) => {
      setLocations((current) => [location, ...current]);
      onSelect(location);
      setShowForm(false);
      setShowChoices(false);
    }} onCancel={() => setShowForm(false)} />;
  }

  return (
    <section className="rounded-[1.5rem] border border-black/5 bg-white p-4 sm:p-5" aria-label="Delivery location">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wider text-black/45">Deliver to</p>
          {selectedLocation ? <p className="mt-1 break-words font-black">📍 {selectedLocation.label}</p> : <p className="mt-1 font-black">Choose a location</p>}
          {selectedLocation && <p className="mt-0.5 break-words text-sm leading-5 text-black/55">{selectedLocation.address}</p>}
        </div>
        <button type="button" onClick={() => setShowChoices((current) => !current)} aria-expanded={showChoices} aria-controls="saved-location-choices" className="min-h-11 shrink-0 rounded-full border border-black/10 px-4 py-2 text-sm font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
          {selectedLocation ? (showChoices ? "Done" : "Change") : "Choose"}
        </button>
      </div>

      <div id="saved-location-choices" hidden={!showChoices} className="mt-4 space-y-2 border-t border-black/5 pt-4" role="group" aria-label="Saved delivery locations">
        {locations.map((location) => <button key={location.id} type="button" onClick={() => { onSelect(location); setShowChoices(false); }} aria-pressed={selectedLocation?.id === location.id} className={`min-h-14 w-full rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${selectedLocation?.id === location.id ? "border-black bg-[#fff4c7]" : "border-black/10 hover:bg-black/[0.02]"}`}>
          <span className="block text-sm font-black">{location.label}</span><span className="mt-0.5 block text-sm text-black/55">{location.address}</span>
        </button>)}
        <button type="button" onClick={() => setShowForm(true)} className="min-h-12 w-full rounded-xl border border-dashed border-black/20 px-4 py-3 text-left text-sm font-black transition hover:bg-black/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">+ Add location</button>
      </div>

      {!selectedLocation && !showChoices && <button type="button" onClick={() => setShowForm(true)} className="mt-3 min-h-11 text-sm font-black underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">+ Add location</button>}
    </section>
  );
}
