import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canContinue, canRetryLiveLocation, gpsFailureMessage } from "./checkout-location-step";
import { CheckoutLocationStep } from "../components/checkout/CheckoutLocationStep";
import { LocationForm } from "../components/checkout/LocationForm";

const faculty = { id: "loc-faculty", label: "Faculty", address: "Faculty of Science, Block 2", instructions: null, latitude: 6.9225, longitude: 3.871801 };
const typed = { id: "loc-typed", label: "Hostel C", address: "Hostel C, Room 12", instructions: "Call me", latitude: null, longitude: null };
const noop = () => {};
const render = (props: Partial<Parameters<typeof CheckoutLocationStep>[0]>) =>
  renderToStaticMarkup(createElement(CheckoutLocationStep, { confirmed: null, onConfirm: noop, onChange: noop, onContinue: noop, ...props }));

test("delivery starts from live location only: one button, no typing and no saved locations up front", () => {
  const html = render({});
  assert.match(html, /Share your live location/);
  assert.match(html, /Use my live location/);
  assert.match(html, /PackAM only delivers on OOU main campus, Ago-Iwoye/);
  assert.equal((html.match(/<button/g) ?? []).length, 1, "nothing else to choose yet");
  assert.doesNotMatch(html, /Enter a delivery location|Use my last location|Enter my location manually/, "typing is offered only after live location fails");
  assert.doesNotMatch(html, /Delivering to/, "nothing is preselected");
});

test("the confirmed location is shown with Change, and Continue only where the page has a next step", () => {
  const html = render({ confirmed: faculty });
  assert.match(html, /Delivering to/);
  assert.match(html, /Faculty of Science, Block 2/);
  assert.match(html, /live location is included for your runner/);
  assert.match(html, />Change</);
  assert.match(html, /Continue/);
  assert.doesNotMatch(html, /Use my live location/, "the start card collapses once confirmed");

  assert.match(render({ confirmed: typed }), /Your runner will use this written location/, "a typed location says it has no pin");
  assert.doesNotMatch(render({ confirmed: faculty, onContinue: undefined }), /Continue/, "printing has no Continue button");
});

test("every live-location failure explains itself and points to typing the location", () => {
  for (const reason of ["denied", "timeout", "unsupported", "unavailable", "imprecise"] as const) {
    assert.match(gpsFailureMessage(reason), /type where you are/i, reason);
  }
  assert.match(gpsFailureMessage("imprecise"), /couldn’t confirm you’re on campus/);
  assert.equal(canRetryLiveLocation("unsupported"), false, "no point retrying without location support");
  for (const reason of ["denied", "timeout", "unavailable", "imprecise"] as const) assert.equal(canRetryLiveLocation(reason), true, reason);
});

test("Continue needs a confirmed, saved location with a written address", () => {
  assert.equal(canContinue(null), false);
  assert.equal(canContinue({ id: "", address: "Hostel C" }), false);
  assert.equal(canContinue({ id: "loc-1", address: "   " }), false);
  assert.equal(canContinue({ id: "loc-1", address: "Hostel C" }), true);
});

test("live location on campus: the pin is shown read-only and a written spot is still required", () => {
  const html = renderToStaticMarkup(createElement(LocationForm, { onSaved: noop, onCancel: noop, pin: { coordinates: { latitude: 6.9225, longitude: 3.871801 }, accuracy: 25 }, title: "You’re on campus", submitLabel: "Confirm this location" }));
  assert.match(html, /Live location from this phone/);
  assert.match(html, /6\.922500, 3\.871801/, "exact coordinates, no invented street name");
  assert.match(html, /Check it’s right on a map/);
  assert.match(html, /id="location-address"[^>]*aria-required="true"/);
  assert.doesNotMatch(html, /type="checkbox"/, "a live pin needs no on-campus promise");
  assert.doesNotMatch(html, /Use my (current|live) location/, "no second GPS button");
});

test("typed by hand: no pin, and the student confirms the location is on OOU main campus", () => {
  const html = renderToStaticMarkup(createElement(LocationForm, { onSaved: noop, onCancel: noop, confirmOnCampus: true, title: "Enter your location on campus", submitLabel: "Use this location" }));
  assert.match(html, /Enter your location on campus/);
  assert.match(html, /Where on campus\?/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /This location is on OOU main campus, Ago-Iwoye/);
  assert.match(html, /Runners can’t deliver to off-campus hostels or other towns/);
  assert.doesNotMatch(html, /GPS|Live location|maps/i);
});
