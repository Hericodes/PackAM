import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryPointFromSnapshot, formatCoordinates, mapsLink, parseCoordinates } from "./delivery-location";

test("coordinates are optional, but must come as a pair", () => {
  assert.deepEqual(parseCoordinates(undefined, undefined), { ok: true, value: null });
  assert.deepEqual(parseCoordinates(null, ""), { ok: true, value: null });
  assert.equal(parseCoordinates(6.8, undefined).ok, false);
  assert.equal(parseCoordinates(null, 3.9).ok, false);
});

test("browser coordinates are validated, not trusted", () => {
  assert.deepEqual(parseCoordinates(6.8123456789, 3.9123456789), { ok: true, value: { latitude: 6.812346, longitude: 3.912346 } });
  assert.deepEqual(parseCoordinates("6.81", "3.91"), { ok: true, value: { latitude: 6.81, longitude: 3.91 } });
  for (const [lat, lng] of [[91, 3], [-91, 3], [6, 181], [6, -181], [Number.NaN, 3], [Infinity, 3], [true, 3], ["6.8abc", "3.9"], [{}, 3], ["1e2", 3], [0, 0]] as [unknown, unknown][]) {
    assert.equal(parseCoordinates(lat, lng).ok, false, `${String(lat)},${String(lng)} must be rejected`);
  }
});

test("coordinates format and link to a map without an API key", () => {
  const point = { latitude: 6.81234, longitude: 3.91234 };
  assert.equal(formatCoordinates(point), "6.812340, 3.912340");
  assert.equal(mapsLink(point), "https://www.google.com/maps/search/?api=1&query=6.812340%2C3.912340");
});

test("delivery point is read from a checkout snapshot, tolerating old or malformed snapshots", () => {
  assert.deepEqual(deliveryPointFromSnapshot({ deliveryLocationLabel: " Hostel C ", deliveryLatitude: 6.81, deliveryLongitude: 3.91 }), { label: "Hostel C", coordinates: { latitude: 6.81, longitude: 3.91 } });
  assert.deepEqual(deliveryPointFromSnapshot({ deliveryAddress: "Old snapshot" }), { label: null, coordinates: null });
  assert.deepEqual(deliveryPointFromSnapshot({ deliveryLatitude: 200, deliveryLongitude: 3.91 }), { label: null, coordinates: null });
  assert.deepEqual(deliveryPointFromSnapshot({ deliveryLatitude: "6.8", deliveryLongitude: "3.9" }), { label: null, coordinates: null });
  assert.deepEqual(deliveryPointFromSnapshot(null), { label: null, coordinates: null });
  assert.deepEqual(deliveryPointFromSnapshot([1, 2]), { label: null, coordinates: null });
});
