"use client";

import { useEffect, useRef, useState } from "react";
import { FAST_FIX, requestPosition, type GeoFailure } from "../../lib/geolocation";
import { gpsFailureMessage, type LocationChoice } from "../../lib/checkout-location-step";
import type { Coordinates } from "../../lib/delivery-location";
import { Icon, type IconName } from "../ui/Icon";
import { LocationForm } from "./LocationForm";
import { hasPin, type DeliveryLocation } from "./LocationSelector";

type Props = {
  /** The student's own most recent delivery location (server-provided), or null if they have none. */
  lastLocation: DeliveryLocation | null;
  /** The confirmed location, or null while the student is still choosing. */
  confirmed: DeliveryLocation | null;
  onConfirm: (location: DeliveryLocation) => void;
  /** The student wants to pick again. */
  onChange: () => void;
  onContinue: () => void;
};

type Gps =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "found"; coordinates: Coordinates; accuracy: number | null }
  | { status: "failed"; reason: Exclude<GeoFailure, "cancelled"> };

const OPTIONS: Array<{ choice: LocationChoice; icon: IconName; title: string; body: string }> = [
  { choice: "current", icon: "mapPin", title: "Use my current location", body: "Share your phone’s location once, then add your exact spot." },
  { choice: "enter", icon: "search", title: "Enter a delivery location", body: "Type your hostel, faculty or a landmark." },
  { choice: "last", icon: "clock", title: "Use my last location", body: "Deliver to the same place as last time." },
];

const backLink = "inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-black/60 hover:text-black";

export function CheckoutLocationStep({ lastLocation, confirmed, onConfirm, onChange, onContinue }: Props) {
  const [choice, setChoice] = useState<LocationChoice | null>(null);
  const [gps, setGps] = useState<Gps>({ status: "idle" });
  const cancelGps = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelGps.current?.(), []);

  async function locate() {
    cancelGps.current?.();
    setGps({ status: "locating" });
    const request = requestPosition(
      { geolocation: typeof navigator !== "undefined" && "geolocation" in navigator ? navigator.geolocation : undefined, secureContext: typeof window !== "undefined" && window.isSecureContext },
      FAST_FIX,
    );
    cancelGps.current = request.cancel;
    const result = await request.result;
    if (cancelGps.current === request.cancel) cancelGps.current = null;
    if (result.ok) setGps({ status: "found", coordinates: result.coordinates, accuracy: result.accuracy });
    else if (result.reason === "cancelled") setGps({ status: "idle" });
    else setGps({ status: "failed", reason: result.reason });
  }

  function choose(next: LocationChoice) {
    setChoice(next);
    // Location permission is asked only when the student picks this option.
    if (next === "current") void locate();
  }

  function reset() {
    cancelGps.current?.();
    setGps({ status: "idle" });
    setChoice(null);
  }

  // ---------------------------------------------------------------- confirmed
  if (confirmed) {
    return (
      <div>
        <div className="flex items-start gap-3 rounded-2xl border-2 border-black bg-[#fffdf7] p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#feb80a]"><Icon name="mapPin" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-wider text-[#875a00]">Delivering to</p>
            <p className="mt-0.5 break-words font-black">{confirmed.label}</p>
            <p className="break-words text-sm leading-5 text-black/70">{confirmed.address}</p>
            <p className="mt-1 text-xs font-semibold text-black/55">{hasPin(confirmed) ? "GPS pin from your phone included for your runner" : "Your runner will use this written location"}</p>
          </div>
          <button type="button" onClick={() => { reset(); onChange(); }} className="min-h-11 shrink-0 rounded-full border border-black/15 bg-white px-4 text-sm font-black hover:bg-black/5">Change</button>
        </div>
        <button type="button" onClick={onContinue} className="pk-btn pk-btn-primary pk-btn-lg mt-4 w-full">Continue <Icon name="arrowRight" className="h-4 w-4" /></button>
      </div>
    );
  }

  // ---------------------------------------------------------------- three options
  if (!choice) {
    return (
      <div role="group" aria-label="Choose how to set your delivery location" className="grid gap-2.5">
        {OPTIONS.map((option) => (
          <button key={option.choice} type="button" onClick={() => choose(option.choice)} className="flex min-h-16 w-full items-center gap-2.5 rounded-2xl border border-black/10 bg-white p-3 text-left transition hover:border-black/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black min-[400px]:gap-3 min-[400px]:p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff4c7] text-[#875a00] min-[400px]:h-11 min-[400px]:w-11"><Icon name={option.icon} className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-black">{option.title}</span>
              <span className="mt-0.5 block text-sm leading-5 text-black/60">{option.choice === "last" && lastLocation ? `${lastLocation.label} · ${lastLocation.address}` : option.body}</span>
            </span>
            <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-black/40 min-[400px]:h-5 min-[400px]:w-5" />
          </button>
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------- 1. current location
  if (choice === "current") {
    if (gps.status === "found") {
      return (
        <div>
          <button type="button" onClick={reset} className={backLink}><Icon name="arrowLeft" className="h-4 w-4" /> Other options</button>
          <LocationForm
            key={`${gps.coordinates.latitude},${gps.coordinates.longitude}`}
            allowGps={false}
            pin={{ coordinates: gps.coordinates, accuracy: gps.accuracy }}
            title="Confirm your location"
            intro="We found your phone’s position. We can’t turn it into a street name, so tell the runner your exact spot (hostel and room, faculty or landmark) and check the pin."
            submitLabel="Confirm this location"
            cancelLabel="Back"
            onSaved={onConfirm}
            onCancel={reset}
          />
        </div>
      );
    }
    return (
      <div>
        <button type="button" onClick={reset} className={backLink}><Icon name="arrowLeft" className="h-4 w-4" /> Other options</button>
        <div className="mt-2 rounded-2xl border border-black/10 bg-[#fffdf7] p-4" aria-live="polite">
          {gps.status === "failed" ? (
            <>
              <p role="alert" className="text-sm font-semibold leading-6 text-[#6b4700]">{gpsFailureMessage(gps.reason)}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => { setGps({ status: "idle" }); setChoice("enter"); }} className="pk-btn pk-btn-primary">Type my location instead</button>
                {gps.reason !== "unsupported" && <button type="button" onClick={() => void locate()} className="pk-btn pk-btn-secondary">Try again</button>}
              </div>
            </>
          ) : (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-black"><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" /> Finding your location…</p>
              <button type="button" onClick={() => { cancelGps.current?.(); setChoice("enter"); }} className="min-h-10 rounded-full border border-black/15 bg-white px-4 text-xs font-bold">Type it instead</button>
              <p className="w-full text-xs text-black/55">Your browser asks first. We read your position once, only for this delivery.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- 2. enter a location
  if (choice === "enter") {
    return (
      <div>
        <button type="button" onClick={reset} className={backLink}><Icon name="arrowLeft" className="h-4 w-4" /> Other options</button>
        <LocationForm
          allowGps={false}
          title="Enter a delivery location"
          intro="Type where the runner should come: hostel and room, faculty building, gate or a landmark."
          submitLabel="Use this location"
          cancelLabel="Back"
          onSaved={onConfirm}
          onCancel={reset}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------- 3. last location
  return (
    <div>
      <button type="button" onClick={reset} className={backLink}><Icon name="arrowLeft" className="h-4 w-4" /> Other options</button>
      {lastLocation ? (
        <div className="mt-2 rounded-2xl border border-black/10 bg-white p-4">
          <p className="text-xs font-black uppercase tracking-wider text-black/50">Your last location</p>
          <p className="mt-1 break-words font-black">{lastLocation.label}</p>
          <p className="break-words text-sm leading-5 text-black/70">{lastLocation.address}</p>
          {lastLocation.instructions && <p className="mt-1 break-words text-xs text-black/55">“{lastLocation.instructions}”</p>}
          <button type="button" onClick={() => onConfirm(lastLocation)} className="pk-btn pk-btn-primary pk-btn-lg mt-4 w-full">Deliver here</button>
        </div>
      ) : (
        <div role="status" className="mt-2 rounded-2xl border border-dashed border-black/20 p-4 text-sm">
          <p className="font-black">No previous location yet</p>
          <p className="mt-1 text-black/60">This looks like your first delivery. Use your current location or type where you are.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => choose("current")} className="pk-btn pk-btn-secondary">Use my current location</button>
            <button type="button" onClick={() => setChoice("enter")} className="pk-btn pk-btn-primary">Enter a delivery location</button>
          </div>
        </div>
      )}
    </div>
  );
}
