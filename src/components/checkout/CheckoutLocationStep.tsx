"use client";

import { useEffect, useRef, useState } from "react";
import { PRECISE_FIX, requestPosition, requestPositionWithFallback } from "../../lib/geolocation";
import { canRetryLiveLocation, gpsFailureMessage, type LiveLocationFailure } from "../../lib/checkout-location-step";
import { mapsLink, type Coordinates } from "../../lib/delivery-location";
import { judgeLiveFix, outsideServiceAreaMessage } from "../../lib/service-area";
import { SERVICE_AREA } from "../../config/service-area";
import { Icon } from "../ui/Icon";
import { LocationForm } from "./LocationForm";
import { hasPin, type DeliveryLocation } from "./LocationSelector";

type Props = {
  /** The confirmed location, or null while the student is still choosing. */
  confirmed: DeliveryLocation | null;
  onConfirm: (location: DeliveryLocation) => void;
  /** The student wants to pick again. */
  onChange: () => void;
  /** Checkout moves on to the next step; printing has no button for it. */
  onContinue?: () => void;
};

type Live =
  | { status: "idle" }
  | { status: "locating"; precise: boolean }
  /** On campus: the student adds their exact spot. */
  | { status: "found"; coordinates: Coordinates; accuracy: number | null }
  /** A reliable fix off campus: refused, no typing option. */
  | { status: "outside"; coordinates: Coordinates; accuracy: number | null }
  /** Live location didn't work: retry, or type the location. */
  | { status: "failed"; reason: LiveLocationFailure }
  /** Typing the location by hand, reachable only from "failed". */
  | { status: "manual"; reason: LiveLocationFailure };

const backLink = "inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-black/60 hover:text-black";

/**
 * Where to deliver: the phone's live location, checked against OOU main campus. Typing a location is
 * offered only when live location fails. Used by shop and food checkout and by printing.
 */
export function CheckoutLocationStep({ confirmed, onConfirm, onChange, onContinue }: Props) {
  const [live, setLive] = useState<Live>({ status: "idle" });
  const cancelGps = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelGps.current?.(), []);

  /** One position request, only after the student asks. Nothing is watched; nothing is sent until they confirm. */
  async function locate(precise: boolean) {
    cancelGps.current?.();
    setLive({ status: "locating", precise });
    const env = { geolocation: typeof navigator !== "undefined" && "geolocation" in navigator ? navigator.geolocation : undefined, secureContext: typeof window !== "undefined" && window.isSecureContext };
    const request = precise ? requestPosition(env, PRECISE_FIX) : requestPositionWithFallback(env);
    cancelGps.current = request.cancel;
    const result = await request.result;
    if (cancelGps.current === request.cancel) cancelGps.current = null;
    if (!result.ok) {
      setLive(result.reason === "cancelled" ? { status: "idle" } : { status: "failed", reason: result.reason });
      return;
    }
    const verdict = judgeLiveFix(result.coordinates, result.accuracy);
    if (verdict === "inside") setLive({ status: "found", coordinates: result.coordinates, accuracy: result.accuracy });
    else if (verdict === "outside") setLive({ status: "outside", coordinates: result.coordinates, accuracy: result.accuracy });
    else setLive({ status: "failed", reason: "imprecise" });
  }

  function reset() {
    cancelGps.current?.();
    setLive({ status: "idle" });
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
            <p className="mt-1 text-xs font-semibold text-black/55">{hasPin(confirmed) ? "Your live location is included for your runner" : "Your runner will use this written location"}</p>
          </div>
          <button type="button" onClick={() => { reset(); onChange(); }} className="min-h-11 shrink-0 rounded-full border border-black/15 bg-white px-4 text-sm font-black hover:bg-black/5">Change</button>
        </div>
        {onContinue && <button type="button" onClick={onContinue} className="pk-btn pk-btn-primary pk-btn-lg mt-4 w-full">Continue <Icon name="arrowRight" className="h-4 w-4" /></button>}
      </div>
    );
  }

  // ---------------------------------------------------------------- on campus: add the exact spot
  if (live.status === "found") {
    return (
      <div>
        <button type="button" onClick={reset} className={backLink}><Icon name="arrowLeft" className="h-4 w-4" /> Start again</button>
        <LocationForm
          key={`${live.coordinates.latitude},${live.coordinates.longitude}`}
          pin={{ coordinates: live.coordinates, accuracy: live.accuracy }}
          title="You’re on campus 👍"
          intro="Now tell your runner your exact spot: hostel and room, faculty building or a landmark. We can’t turn your location into a street name."
          submitLabel="Confirm this location"
          cancelLabel="Back"
          onSaved={onConfirm}
          onCancel={reset}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------- typed by hand (live location failed)
  if (live.status === "manual") {
    const failedReason = live.reason;
    return (
      <div>
        <button type="button" onClick={() => setLive({ status: "failed", reason: failedReason })} className={backLink}><Icon name="arrowLeft" className="h-4 w-4" /> Back</button>
        <LocationForm
          confirmOnCampus
          title="Enter your location on campus"
          intro={`We couldn’t get your live location, so type where you are on ${SERVICE_AREA.placeLabel}: hostel and room, faculty building, gate or a landmark.`}
          submitLabel="Use this location"
          cancelLabel="Back"
          onSaved={onConfirm}
          onCancel={() => setLive({ status: "failed", reason: failedReason })}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------- off campus
  if (live.status === "outside") {
    return (
      <div role="alert" className="rounded-2xl border border-[#c92d24]/20 bg-[#ffe9e7] p-4">
        <p className="font-black text-[#a3241c]">You’re outside campus</p>
        <p className="mt-1 text-sm leading-6 text-black/75">{outsideServiceAreaMessage(live.coordinates)} When you’re on campus, try again.</p>
        <a href={mapsLink(live.coordinates)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-9 items-center gap-1 text-xs font-bold underline underline-offset-2">See where your phone put you <Icon name="arrowRight" className="h-3 w-3" /></a>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => void locate(true)} className="pk-btn pk-btn-primary">Try again</button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- live location didn't work
  if (live.status === "failed") {
    const failedReason = live.reason;
    return (
      <div className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
        <p role="alert" className="text-sm font-semibold leading-6 text-[#6b4700]">{gpsFailureMessage(failedReason)}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          {canRetryLiveLocation(failedReason) && <button type="button" onClick={() => void locate(failedReason === "imprecise")} className="pk-btn pk-btn-primary">Try again</button>}
          <button type="button" onClick={() => setLive({ status: "manual", reason: failedReason })} className={`pk-btn ${canRetryLiveLocation(failedReason) ? "pk-btn-secondary" : "pk-btn-primary"}`}>Enter my location manually</button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- finding the phone
  if (live.status === "locating") {
    return (
      <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
        <p className="flex items-center gap-2 text-sm font-black"><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" /> {live.precise ? "Getting a more precise location…" : "Finding your location…"}</p>
        <button type="button" onClick={() => cancelGps.current?.()} className="min-h-10 rounded-full border border-black/15 bg-white px-4 text-xs font-bold hover:bg-black/5">Stop</button>
        <p className="w-full text-xs text-black/55">If your browser asks, tap Allow. We read your position once, only for this delivery.</p>
      </div>
    );
  }

  // ---------------------------------------------------------------- start: live location
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff4c7] text-[#875a00]"><Icon name="mapPin" className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="font-black">Share your live location</p>
          <p className="mt-0.5 text-sm leading-5 text-black/60">PackAM only delivers on {SERVICE_AREA.placeLabel}. Your live location confirms you’re on campus and shows your runner where to come.</p>
        </div>
      </div>
      <button type="button" onClick={() => void locate(false)} className="pk-btn pk-btn-primary pk-btn-lg mt-4 w-full"><Icon name="mapPin" className="h-[18px] w-[18px]" /> Use my live location</button>
      <p className="mt-2 text-xs leading-5 text-black/55">Your browser asks first. We read your position once and save it only with this delivery. We don’t track you.</p>
    </div>
  );
}
