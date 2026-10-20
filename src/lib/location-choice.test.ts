import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CAMPUS_PLACES, type CampusPlace } from "../config/campus-places";
import { campusPlaceAddress, deriveLocationLabel, matchCampusPlaces, orderLocationsForCheckout, pickInitialLocation } from "./location-choice";
import { LocationForm } from "../components/checkout/LocationForm";

// Test fixture only: not real campus data.
const PLACES: CampusPlace[] = [
  { name: "Hostel Alpha", kind: "HOSTEL", area: "Test campus", aliases: ["Hall A"], verified: true },
  { name: "Hostel Beta", kind: "HOSTEL", area: "Test campus", verified: false },
  { name: "Faculty of Testing", kind: "FACULTY", aliases: ["FOT"], verified: false },
  { name: "North Gate", kind: "GATE", verified: true },
];

test("a location name is derived from the written location when the student skips it", () => {
  assert.equal(deriveLocationLabel("Hostel C, Room 12, opposite the chapel"), "Hostel C");
  assert.equal(deriveLocationLabel("  Main gate  "), "Main gate");
  assert.equal(deriveLocationLabel("Block 4\nRoom 2"), "Block 4");
  const long = deriveLocationLabel("A".repeat(80));
  assert.ok(long.length <= 50 && long.endsWith("…"));
});

test("saved locations: last used first and preselected; this session's choice wins; stale ids ignored", () => {
  const saved = [{ id: "new" }, { id: "older" }, { id: "oldest" }];
  assert.deepEqual(orderLocationsForCheckout(saved, "oldest").map((l) => l.id), ["oldest", "new", "older"]);
  assert.deepEqual(orderLocationsForCheckout(saved, "deleted"), saved, "a deleted last-used location changes nothing");
  assert.deepEqual(orderLocationsForCheckout(saved, null), saved);
  const ordered = orderLocationsForCheckout(saved, "oldest");
  assert.equal(pickInitialLocation(ordered, null)?.id, "oldest");
  assert.equal(pickInitialLocation(ordered, "older")?.id, "older", "kept across a reload or a return from OPay");
  assert.equal(pickInitialLocation(ordered, "someone-elses-id")?.id, "oldest");
  assert.equal(pickInitialLocation([], "older"), null);
});

test("campus search matches word starts in names, aliases and kinds, verified first", () => {
  assert.deepEqual(matchCampusPlaces("hos", PLACES).map((p) => p.name), ["Hostel Alpha", "Hostel Beta"]);
  assert.deepEqual(matchCampusPlaces("hall a", PLACES).map((p) => p.name), ["Hostel Alpha"]);
  assert.deepEqual(matchCampusPlaces("fot", PLACES).map((p) => p.name), ["Faculty of Testing"]);
  assert.deepEqual(matchCampusPlaces("gate", PLACES).map((p) => p.name), ["North Gate"]);
  assert.deepEqual(matchCampusPlaces("library", PLACES), [], "no results rather than a guess");
  assert.deepEqual(matchCampusPlaces("h", PLACES), [], "one character is too short to search");
  // Matching is synchronous and local, so the latest input always determines the result: no stale responses.
  assert.notDeepEqual(matchCampusPlaces("hostel b", PLACES), matchCampusPlaces("hostel", PLACES));
  assert.equal(campusPlaceAddress(PLACES[0]), "Hostel Alpha, Test campus");
});

test("the shipped campus list invents nothing: it is empty until operations adds confirmed places", () => {
  assert.equal(CAMPUS_PLACES.length, 0);
  for (const place of CAMPUS_PLACES) assert.ok(!("latitude" in place) && !("longitude" in place), "campus places never carry coordinates");
});

test("the new-location form needs only the written location; name, GPS and directions are optional", () => {
  const html = renderToStaticMarkup(createElement(LocationForm, { onSaved: () => {}, onCancel: () => {}, places: PLACES }));
  assert.match(html, /Where on campus\?/);
  assert.match(html, /id="location-address"[^>]*aria-required="true"/);
  assert.doesNotMatch(html, /id="location-label"[^>]*aria-required="true"/);
  assert.match(html, /Name for this location <span[^>]*>\(optional\)/);
  assert.match(html, /Use my current location/);
  assert.match(html, /Meet me at the hostel gate/);
  // Address field comes before the GPS button: typing is never blocked behind location access.
  assert.ok(html.indexOf("location-address") < html.indexOf("Use my current location"));
});
