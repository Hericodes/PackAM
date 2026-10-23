/**
 * One-off browser position requests for delivery locations. Pure (the geolocation object is passed
 * in) so success, denial, timeout, missing hardware and a never-answered permission prompt are all
 * unit-tested. Nothing here watches the user: each call asks once and settles exactly once.
 */
import { parseCoordinates, type Coordinates } from "./delivery-location";

export type GeoFailure = "denied" | "unavailable" | "timeout" | "unsupported" | "cancelled";
export type GeoResult = { ok: true; coordinates: Coordinates; accuracy: number | null } | { ok: false; reason: GeoFailure };

type PositionLike = { coords: { latitude: number; longitude: number; accuracy: number } };
type GeolocationLike = {
  getCurrentPosition(success: (position: PositionLike) => void, error: (failure: { code: number }) => void, options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }): void;
};

/**
 * Fast first fix: Wi-Fi/cell positioning answers in about a second where satellite GPS can take the
 * whole timeout indoors. A recent cached fix (≤2 min) is reused rather than asking the hardware again.
 */
export const FAST_FIX = { enableHighAccuracy: false, timeout: 8_000, maximumAge: 120_000 } as const;
/** Optional second pass when the first fix is coarse. Never reuses a cached position. */
export const PRECISE_FIX = { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 } as const;
/**
 * Hard ceiling, including time spent on the permission prompt (the browser's own timeout only starts
 * after permission is granted), so the interface can never sit on "Finding your location…" forever.
 */
export const GEO_WATCHDOG_MS = 20_000;
/** Above this, the pin is shown as approximate and a precise retry is offered. */
export const COARSE_ACCURACY_METRES = 100;

export function requestPosition(
  env: { geolocation: GeolocationLike | undefined; secureContext: boolean },
  options: { enableHighAccuracy: boolean; timeout: number; maximumAge: number } = FAST_FIX,
  watchdogMs = GEO_WATCHDOG_MS,
): { result: Promise<GeoResult>; cancel: () => void } {
  if (!env.geolocation || !env.secureContext) return { result: Promise.resolve({ ok: false, reason: "unsupported" }), cancel: () => {} };
  let settle: (result: GeoResult) => void = () => {};
  let settled = false;
  const result = new Promise<GeoResult>((resolve) => {
    settle = (value) => {
      if (settled) return; // late callbacks after a timeout or cancel are ignored
      settled = true;
      clearTimeout(watchdog);
      resolve(value);
    };
  });
  // Declared after `settle`, which only runs once a callback, the watchdog or cancel fires.
  const watchdog = setTimeout(() => settle({ ok: false, reason: "timeout" }), watchdogMs);
  try {
    env.geolocation.getCurrentPosition(
      (position) => {
        const parsed = parseCoordinates(position.coords.latitude, position.coords.longitude);
        if (!parsed.ok || !parsed.value) return settle({ ok: false, reason: "unavailable" });
        settle({ ok: true, coordinates: parsed.value, accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null });
      },
      (failure) => settle({ ok: false, reason: failure.code === 1 ? "denied" : failure.code === 3 ? "timeout" : "unavailable" }),
      options,
    );
  } catch {
    settle({ ok: false, reason: "unavailable" });
  }
  return { result, cancel: () => settle({ ok: false, reason: "cancelled" }) };
}

/**
 * The fast fix first; if it finds nothing (no Wi-Fi/cell position, or it timed out), one satellite-GPS
 * attempt before giving up, since outdoors or with Wi-Fi scanning off GPS is often what works.
 * A denial, a missing API or a cancel is final: the student is never asked twice.
 */
export function requestPositionWithFallback(
  env: { geolocation: GeolocationLike | undefined; secureContext: boolean },
  watchdogMs = GEO_WATCHDOG_MS,
): { result: Promise<GeoResult>; cancel: () => void } {
  let current = requestPosition(env, FAST_FIX, watchdogMs);
  let cancelled = false;
  const result = current.result.then((first) => {
    if (first.ok || cancelled || (first.reason !== "unavailable" && first.reason !== "timeout")) return first;
    current = requestPosition(env, PRECISE_FIX, watchdogMs);
    return current.result;
  });
  return { result, cancel: () => { cancelled = true; current.cancel(); } };
}

export function isCoarse(accuracy: number | null) {
  return accuracy === null || accuracy > COARSE_ACCURACY_METRES;
}
