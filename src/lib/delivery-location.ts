/**
 * Delivery-location rules shared by the locations API, checkout snapshot and runner view.
 * Coordinates are optional extras: a written campus location is always required, so a runner never
 * depends on GPS alone and a student who declines location access can still check out.
 */

export type Coordinates = { latitude: number; longitude: number };

const NUMERIC = /^-?\d{1,3}(\.\d{1,12})?$/;

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && NUMERIC.test(value.trim())) return Number(value.trim());
  return Number.NaN;
}

const isBlank = (value: unknown) => value === undefined || value === null || value === "";

/**
 * Validates browser-supplied coordinates. Both or neither must be sent; values must be real numbers
 * (not booleans or arbitrary strings) within range. 0,0 is rejected as the classic "no fix" value.
 */
export function parseCoordinates(latitude: unknown, longitude: unknown): { ok: true; value: Coordinates | null } | { ok: false; error: string } {
  if (isBlank(latitude) && isBlank(longitude)) return { ok: true, value: null };
  if (isBlank(latitude) || isBlank(longitude)) return { ok: false, error: "Send both latitude and longitude, or neither." };
  const lat = toNumber(latitude);
  const lng = toNumber(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: "Invalid latitude." };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: "Invalid longitude." };
  if (lat === 0 && lng === 0) return { ok: false, error: "That GPS position doesn’t look right. Try again or enter your location." };
  // ~11 cm precision is far beyond phone GPS accuracy; storing more adds nothing.
  return { ok: true, value: { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 } };
}

export function formatCoordinates({ latitude, longitude }: Coordinates) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/** Google Maps URL scheme (no API key needed): opens the pin in the Maps app or website. */
export function mapsLink({ latitude, longitude }: Coordinates) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude.toFixed(6)}%2C${longitude.toFixed(6)}`;
}

export type SnapshotDeliveryPoint = { label: string | null; coordinates: Coordinates | null };

/**
 * Reads the delivery label and coordinates frozen into a payment's checkout snapshot. Older snapshots
 * (before coordinates were captured) or malformed values simply yield nulls; they never throw, so a
 * paid order can always be finalized and shown.
 */
export function deliveryPointFromSnapshot(raw: unknown): SnapshotDeliveryPoint {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { label: null, coordinates: null };
  const snapshot = raw as Record<string, unknown>;
  const label = typeof snapshot.deliveryLocationLabel === "string" && snapshot.deliveryLocationLabel.trim() ? snapshot.deliveryLocationLabel.trim().slice(0, 50) : null;
  const parsed = typeof snapshot.deliveryLatitude === "number" && typeof snapshot.deliveryLongitude === "number"
    ? parseCoordinates(snapshot.deliveryLatitude, snapshot.deliveryLongitude)
    : null;
  return { label, coordinates: parsed?.ok ? parsed.value : null };
}
