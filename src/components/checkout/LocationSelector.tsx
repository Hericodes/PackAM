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
    <section className="rounded-[1.5rem] border border-black/5 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-black/45">DELIVER TO</p>
          {selectedLocation ? <p className="mt-1 truncate font-black">📍 {selectedLocation.label}</p> : <p className="mt-1 font-black">Choose a location</p>}
          {selectedLocation && <p className="mt-0.5 truncate text-sm text-black/55">{selectedLocation.address}</p>}
        </div>
        <button type="button" onClick={() => setShowChoices((current) => !current)} className="shrink-0 rounded-full border border-black/10 px-4 py-2 text-sm font-black hover:bg-black/5">
          {selectedLocation ? (showChoices ? "Done" : "Change") : "Choose"}
        </button>
      </div>

      {showChoices && <div className="mt-4 space-y-2 border-t border-black/5 pt-4">
        {locations.map((location) => <button key={location.id} type="button" onClick={() => { onSelect(location); setShowChoices(false); }} className={`w-full rounded-xl border p-3 text-left ${selectedLocation?.id === location.id ? "border-black bg-[#fff4c7]" : "border-black/10"}`}>
          <span className="block text-sm font-black">{location.label}</span><span className="mt-0.5 block text-sm text-black/55">{location.address}</span>
        </button>)}
        <button type="button" onClick={() => setShowForm(true)} className="w-full rounded-xl border border-dashed border-black/20 px-4 py-3 text-left text-sm font-black hover:bg-black/[0.02]">+ Add location</button>
      </div>}

      {!selectedLocation && !showChoices && <button type="button" onClick={() => setShowForm(true)} className="mt-3 text-sm font-black underline underline-offset-4">+ Add location</button>}
    </section>
  );
}
