/**
 * Rules for checkout's three-option location step. Pure, so it is unit-tested.
 *
 * 1. Use my current location: one GPS fix from the student's phone, then they add a short written spot.
 *    PackAM has no address-lookup (reverse-geocoding) service, so coordinates are never turned into a
 *    made-up street name; the pin goes to the runner exactly as the phone reported it.
 * 2. Enter a delivery location: type it (campus suggestions appear when operations has added places).
 * 3. Use my last location: the student's own most recent delivery location, shown before they confirm.
 */
import type { GeoFailure } from "./geolocation";

export type LocationChoice = "current" | "enter" | "last";

/** The student's most recent valid delivery location: the one their last order used, else their newest saved. */
export function lastLocationFor<T extends { id: string }>(savedNewestFirst: T[], lastOrderLocationId: string | null | undefined) {
  return (lastOrderLocationId ? savedNewestFirst.find((location) => location.id === lastOrderLocationId) : undefined) ?? savedNewestFirst[0] ?? null;
}

/** Why GPS didn't work, in plain words, always pointing to manual entry. */
export function gpsFailureMessage(reason: Exclude<GeoFailure, "cancelled">) {
  switch (reason) {
    case "denied": return "Location access was turned off for PackAM. No wahala — type where you are instead.";
    case "timeout": return "Finding your location took too long. Try again outdoors, or type where you are.";
    case "unsupported": return "This browser can’t share your location. Type where you are instead.";
    case "unavailable": return "We couldn’t get your position right now. Try again, or type where you are.";
  }
}

/** Continue is offered only once a saved, server-validated location has been confirmed. */
export function canContinue(confirmed: { id: string; address: string } | null) {
  return Boolean(confirmed?.id && confirmed.address.trim());
}
