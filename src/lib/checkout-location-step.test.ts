import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canContinue, gpsFailureMessage, lastLocationFor } from "./checkout-location-step";
import { CheckoutLocationStep } from "../components/checkout/CheckoutLocationStep";
import { LocationForm } from "../components/checkout/LocationForm";

const hostel = { id: "loc-hostel", label: "Hostel C", address: "Hostel C, Room 12", instructions: "Call me", latitude: null, longitude: null };
const faculty = { id: "loc-faculty", label: "Faculty", address: "Faculty of Science, Block 2", instructions: null, latitude: 6.812345, longitude: 3.912345 };
const noop = () => {};
const render = (props: Partial<Parameters<typeof CheckoutLocationStep>[0]>) =>
  renderToStaticMarkup(createElement(CheckoutLocationStep, { lastLocation: null, confirmed: null, onConfirm: noop, onChange: noop, onContinue: noop, ...props }));

test("checkout always starts with exactly the three location options", () => {
  const html = render({ lastLocation: hostel });
  for (const label of ["Use my current location", "Enter a delivery location", "Use my last location"]) assert.match(html, new RegExp(label), label);
  assert.equal((html.match(/<button/g) ?? []).length, 3, "three choices, nothing else to fill in yet");
  assert.doesNotMatch(html, /Delivering to/, "nothing is preselected");
  assert.match(html, /Hostel C · Hostel C, Room 12/, "the last location is shown on its card");
});

test("without a previous location the last-location card still explains itself", () => {
  const html = render({ lastLocation: null });
  assert.match(html, /Deliver to the same place as last time/);
});

test("the confirmed location is shown prominently with Change and Continue", () => {
  const html = render({ confirmed: faculty });
  assert.match(html, /Delivering to/);
  assert.match(html, /Faculty of Science, Block 2/);
  assert.match(html, /GPS pin from your phone included/);
  assert.match(html, />Change</);
  assert.match(html, /Continue/);
  assert.doesNotMatch(html, /Use my current location/, "the options collapse once confirmed");
});

test("last location: the student's last-used location, else their newest; never someone else's", () => {
  assert.equal(lastLocationFor([hostel, faculty], "loc-faculty")?.id, "loc-faculty");
  assert.equal(lastLocationFor([hostel, faculty], null)?.id, "loc-hostel", "falls back to the newest saved location");
  assert.equal(lastLocationFor([hostel], "another-students-location")?.id, "loc-hostel", "an id outside the student's own list is ignored");
  assert.equal(lastLocationFor([], "loc-faculty"), null);
});

test("every GPS failure explains itself and points to typing the location", () => {
  for (const reason of ["denied", "timeout", "unsupported", "unavailable"] as const) {
    assert.match(gpsFailureMessage(reason), /type where you are/i, reason);
  }
});

test("Continue needs a confirmed, saved location with a written address", () => {
  assert.equal(canContinue(null), false);
  assert.equal(canContinue({ id: "", address: "Hostel C" }), false);
  assert.equal(canContinue({ id: "loc-1", address: "   " }), false);
  assert.equal(canContinue({ id: "loc-1", address: "Hostel C" }), true);
});

test("current location: the phone's pin is shown read-only and a written spot is still required", () => {
  const html = renderToStaticMarkup(createElement(LocationForm, { onSaved: noop, onCancel: noop, allowGps: false, pin: { coordinates: { latitude: 6.812345, longitude: 3.912345 }, accuracy: 25 }, title: "Confirm your location", submitLabel: "Confirm this location" }));
  assert.match(html, /Confirm your location/);
  assert.match(html, /GPS pin from this phone/);
  assert.match(html, /6\.812345, 3\.912345/, "exact coordinates, no invented street name");
  assert.match(html, /Check it’s right on a map/);
  assert.match(html, /id="location-address"[^>]*aria-required="true"/);
  assert.doesNotMatch(html, /Use my current location/, "no second GPS button");
});

test("enter a location: type-only, no GPS or map needed", () => {
  const html = renderToStaticMarkup(createElement(LocationForm, { onSaved: noop, onCancel: noop, allowGps: false, title: "Enter a delivery location", submitLabel: "Use this location" }));
  assert.match(html, /Enter a delivery location/);
  assert.match(html, /Where on campus\?/);
  assert.doesNotMatch(html, /GPS pin|Use my current location|maps/i);
  assert.match(html, /Use this location/);
});
