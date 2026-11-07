import assert from "node:assert/strict";
import { test } from "node:test";
import { SERVICE_AREA } from "../config/service-area";
import {
  OutsideServiceAreaError,
  UNRELIABLE_ACCURACY_METRES,
  assertDeliverableLocation,
  distanceMetres,
  formatDistance,
  isInsideServiceArea,
  judgeLiveFix,
  outsideServiceAreaMessage,
} from "./service-area";

// Corners of the OOU main campus outline in OpenStreetMap (way 789111299).
const campusCorners = [
  { latitude: 6.9142764, longitude: 3.8659178 },
  { latitude: 6.9142764, longitude: 3.87696 },
  { latitude: 6.9294282, longitude: 3.8659178 },
  { latitude: 6.9294282, longitude: 3.87696 },
];
const ogunPlaces = {
  agoIwoyeTown: { latitude: 6.942359, longitude: 3.921554 },
  ijebuOde: { latitude: 6.8194, longitude: 3.9173 },
  sagamuTeachingHospital: { latitude: 6.8492, longitude: 3.6531 },
  lagosIsland: { latitude: 6.4541, longitude: 3.3947 },
};

test("distance is the real ground distance (haversine)", () => {
  // On a spherical Earth one degree of latitude is 111.2 km (the real ellipsoid gives 110.6 km here: 0.5%, nothing at 2 km).
  const oneDegree = distanceMetres({ latitude: 6.5, longitude: 3.8 }, { latitude: 7.5, longitude: 3.8 });
  assert.ok(Math.abs(oneDegree - 111_195) < 10, String(oneDegree));
  assert.equal(distanceMetres(SERVICE_AREA.center, SERVICE_AREA.center), 0);
});

test("the whole OOU main campus is inside the delivery area, with slack for GPS error", () => {
  assert.equal(isInsideServiceArea(SERVICE_AREA.center), true);
  for (const corner of campusCorners) {
    assert.equal(isInsideServiceArea(corner), true, JSON.stringify(corner));
    assert.ok(SERVICE_AREA.radiusMetres - distanceMetres(SERVICE_AREA.center, corner) > 800, "at least 800 m to spare past every corner");
  }
});

test("off-campus places are outside: Ago-Iwoye town, Ijebu-Ode, Sagamu and Lagos", () => {
  for (const [name, point] of Object.entries(ogunPlaces)) assert.equal(isInsideServiceArea(point), false, name);
});

test("a live fix: inside wins; outside is final only when the fix is reliable", () => {
  assert.equal(judgeLiveFix(SERVICE_AREA.center, 15), "inside");
  assert.equal(judgeLiveFix(SERVICE_AREA.center, 5_000), "inside", "a rough fix that lands on campus is accepted");
  assert.equal(judgeLiveFix(ogunPlaces.agoIwoyeTown, 30), "outside");
  assert.equal(judgeLiveFix(ogunPlaces.agoIwoyeTown, UNRELIABLE_ACCURACY_METRES), "outside", "the limit itself still counts as reliable");
  assert.equal(judgeLiveFix(ogunPlaces.lagosIsland, UNRELIABLE_ACCURACY_METRES + 1), "imprecise", "a vague fix never refuses a student");
  assert.equal(judgeLiveFix(ogunPlaces.lagosIsland, null), "imprecise", "no accuracy reported");
});

test("messages say how far outside campus and what the rule is", () => {
  assert.equal(formatDistance(4), "10 m");
  assert.equal(formatDistance(847), "850 m");
  assert.equal(formatDistance(3_456), "3.5 km");
  assert.equal(formatDistance(56_700), "57 km");
  const message = outsideServiceAreaMessage(ogunPlaces.agoIwoyeTown);
  assert.match(message, /^Your location is about \d\.\d km outside campus\./);
  assert.match(message, /PackAM only delivers on OOU main campus, Ago-Iwoye\./);
  assert.match(outsideServiceAreaMessage(null), /Choose a location on campus/);
});

test("payment refuses a saved pin outside campus; a typed location with no pin passes", () => {
  assert.doesNotThrow(() => assertDeliverableLocation({ latitude: null, longitude: null }));
  assert.doesNotThrow(() => assertDeliverableLocation(SERVICE_AREA.center));
  assert.throws(() => assertDeliverableLocation(ogunPlaces.ijebuOde), (error: Error) => error instanceof OutsideServiceAreaError && /outside campus/.test(error.message));
});
