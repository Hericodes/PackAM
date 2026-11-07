/**
 * PackAM delivers only inside its service area (OOU main campus, src/config/service-area.ts). Pure, so
 * the checks are unit-tested and the server and the browser give the same answer.
 *
 * A GPS pin must be inside the area: the locations API refuses one outside, and payment refuses a
 * saved location whose pin is outside. A location typed by hand (allowed only when live location
 * fails) has no pin and can't be checked here; checkout asks the student to confirm it is on campus.
 */
import { SERVICE_AREA, type ServiceArea } from "../config/service-area";
import type { Coordinates } from "./delivery-location";

const EARTH_RADIUS_METRES = 6_371_008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle (haversine) distance in metres. Plenty accurate over a few kilometres. */
export function distanceMetres(a: Coordinates, b: Coordinates) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceFromServiceArea(point: Coordinates, area: ServiceArea = SERVICE_AREA) {
  return distanceMetres(area.center, point);
}

export function isInsideServiceArea(point: Coordinates, area: ServiceArea = SERVICE_AREA) {
  return distanceFromServiceArea(point, area) <= area.radiusMetres;
}

/**
 * A fix vaguer than this (Wi-Fi-less phones, IP-based desktop guesses) can't place a student on or off
 * campus, so it counts as live location not working: the student may retry or type their location.
 */
export const UNRELIABLE_ACCURACY_METRES = 1_000;

export type LiveFixVerdict = "inside" | "outside" | "imprecise";

/**
 * What a live position means for delivery. Inside wins even when the fix is rough. Outside is only
 * final when the fix is reliable; a rough fix outside the area is "imprecise", never a refusal.
 */
export function judgeLiveFix(point: Coordinates, accuracy: number | null, area: ServiceArea = SERVICE_AREA): LiveFixVerdict {
  if (isInsideServiceArea(point, area)) return "inside";
  if (accuracy === null || accuracy > UNRELIABLE_ACCURACY_METRES) return "imprecise";
  return "outside";
}

/** "1.2 km" / "850 m": how far a pin is from the edge of the area, for messages. */
export function formatDistance(metres: number) {
  if (metres < 1_000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1_000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

export function outsideServiceAreaMessage(point: Coordinates | null, area: ServiceArea = SERVICE_AREA) {
  const rule = `PackAM only delivers on ${area.placeLabel}.`;
  if (!point) return `${rule} Choose a location on campus.`;
  const beyond = distanceFromServiceArea(point, area) - area.radiusMetres;
  return `Your location is about ${formatDistance(Math.max(0, beyond))} outside campus. ${rule}`;
}

/** A saved location's pin is outside the service area. Nothing was created or charged. */
export class OutsideServiceAreaError extends Error {
  constructor(readonly point: Coordinates | null) {
    super(`This delivery location is outside campus. ${outsideServiceAreaMessage(null)}`);
    this.name = "OutsideServiceAreaError";
  }
}

/** Refuses a saved location whose pin is outside the area. A location without a pin (typed by hand) passes. */
export function assertDeliverableLocation(location: { latitude: number | null; longitude: number | null }, area: ServiceArea = SERVICE_AREA) {
  if (location.latitude === null || location.longitude === null) return;
  const point = { latitude: location.latitude, longitude: location.longitude };
  if (!isInsideServiceArea(point, area)) throw new OutsideServiceAreaError(point);
}
