/**
 * Rules for the live-location delivery step (shop and food checkout, and printing). Pure, so it is unit-tested.
 *
 * 1. Live location first, and only: one GPS fix from the student's phone. It must be on OOU main campus
 *    (src/lib/service-area.ts); then the student adds their exact spot (hostel and room, faculty, landmark).
 *    PackAM has no address lookup, so coordinates are never turned into a made-up street name.
 * 2. Typing a location is offered only when live location fails: permission denied, no position, too slow,
 *    an unsupported browser, or a fix too rough to place the student on campus. The student confirms the
 *    typed location is on campus.
 * 3. A reliable fix outside campus is refused, with no typing option: PackAM only delivers on campus.
 */
import type { GeoFailure } from "./geolocation";

/** Why live location didn't work: the browser's reasons, plus a fix too rough to check against campus. */
export type LiveLocationFailure = Exclude<GeoFailure, "cancelled"> | "imprecise";

/** Why live location didn't work, in plain words, always pointing to typing the location instead. */
export function gpsFailureMessage(reason: LiveLocationFailure) {
  switch (reason) {
    case "denied": return "Location access is turned off for PackAM. Allow it in your browser and try again, or type where you are instead.";
    case "timeout": return "Finding your location took too long. Try again outdoors, or type where you are.";
    case "unsupported": return "This browser can’t share your location. Type where you are instead.";
    case "unavailable": return "We couldn’t get your position right now. Try again, or type where you are.";
    case "imprecise": return "Your phone could only give a rough position, so we couldn’t confirm you’re on campus. Try again outdoors, or type where you are.";
  }
}

/** Trying again helps unless the browser has no location support at all. */
export function canRetryLiveLocation(reason: LiveLocationFailure) {
  return reason !== "unsupported";
}

/** Continue is offered only once a saved, server-validated location has been confirmed. */
export function canContinue(confirmed: { id: string; address: string } | null) {
  return Boolean(confirmed?.id && confirmed.address.trim());
}
