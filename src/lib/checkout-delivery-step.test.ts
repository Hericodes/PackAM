import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { deliveryTierProblem, initialDeliveryTier, paymentAttemptStorageKey, visibleDeliveryTiers } from "./checkout-delivery-step";
import { fallbackQuoteSet, quotesFromRows, type DeliveryTierQuote, type DeliveryTierSettingRow } from "./delivery-tiers";
import { DeliveryTierSelector } from "../components/checkout/DeliveryTierSelector";
import { CheckoutClient } from "../components/checkout/CheckoutClient";
import { CartExperience } from "../components/cart/CartExperience";
import { DEFAULT_ORDERING_HOURS, type OrderingClock } from "./ordering-hours";

const APPROVED: DeliveryTierSettingRow[] = [
  { tier: "CRUISE", fee: 200, enabled: true, etaMinMinutes: 20, etaMaxMinutes: 30, version: 1 },
  { tier: "SHARP", fee: 300, enabled: true, etaMinMinutes: 15, etaMaxMinutes: 25, version: 1 },
  { tier: "OYA", fee: 400, enabled: true, etaMinMinutes: 10, etaMaxMinutes: 15, version: 1 },
];
const all = quotesFromRows(APPROVED).quotes;
const without = (tier: string) => quotesFromRows(APPROVED.map((row) => row.tier === tier ? { ...row, enabled: false } : row)).quotes;
const noop = () => {};
/** The <input> for one speed (React orders attributes its own way). */
const radio = (html: string, tier: string) => html.match(new RegExp(`<input[^>]*value="${tier}"[^>]*>`))?.[0] ?? "";
const render = (props: Partial<Parameters<typeof DeliveryTierSelector>[0]>) => renderToStaticMarkup(createElement(DeliveryTierSelector, { tiers: all, selected: "CRUISE", onSelect: noop, ...props }));

test("Cruise Mode is preselected when it's on sale; otherwise nothing is, and the student must choose", () => {
  assert.equal(initialDeliveryTier(all), "CRUISE");
  assert.equal(initialDeliveryTier(without("CRUISE")), null);
  assert.equal(initialDeliveryTier(fallbackQuoteSet().quotes), "CRUISE");
});

test("speeds on sale are listed in the approved order; a chosen speed that stopped being available stays listed", () => {
  assert.deepEqual(visibleDeliveryTiers(all, "CRUISE").map((q) => q.tier), ["CRUISE", "SHARP", "OYA"]);
  assert.deepEqual(visibleDeliveryTiers(without("SHARP"), "CRUISE").map((q) => q.tier), ["CRUISE", "OYA"]);
  assert.deepEqual(visibleDeliveryTiers(without("SHARP"), "SHARP").map((q) => q.tier), ["CRUISE", "SHARP", "OYA"], "never silently dropped");
  assert.deepEqual(visibleDeliveryTiers(fallbackQuoteSet().quotes, "CRUISE").map((q) => q.tier), ["CRUISE"], "before the migration: Cruise Mode only, as today");
});

test("a chosen speed that became unavailable is a problem to fix, never a switch", () => {
  assert.equal(deliveryTierProblem(all, "OYA"), null);
  assert.equal(deliveryTierProblem(without("OYA"), "OYA"), "Oya Now! isn’t available right now. Choose another delivery speed.");
  assert.equal(deliveryTierProblem(all, null), "Choose a delivery speed to continue.");
  assert.equal(deliveryTierProblem(quotesFromRows(APPROVED.map((row) => ({ ...row, enabled: false }))).quotes, null), "Delivery isn’t available right now. Please try again later.");
});

test("the payment attempt key covers the speed and fee, so two speeds at the same price never share an attempt", () => {
  const base = { locationId: "loc", instructions: " Gate ", items: [{ id: "b", quantity: 1 }, { id: "a", quantity: 2 }], deliveryFee: 300, total: 3300 };
  const sharp = paymentAttemptStorageKey({ ...base, tier: "SHARP" });
  assert.equal(sharp, "packam-payment-attempt:loc:Gate:ax2,bx1:SHARP:300:3300");
  assert.notEqual(paymentAttemptStorageKey({ ...base, tier: "OYA" }), sharp);
  assert.notEqual(paymentAttemptStorageKey({ ...base, tier: "SHARP", deliveryFee: 350, total: 3350 }), sharp);
  assert.equal(paymentAttemptStorageKey({ ...base, items: [...base.items].reverse(), tier: "SHARP" }), sharp, "cart order doesn't matter");
});

test("the selector is a labelled radio group showing each speed's fee, window and approved description", () => {
  const html = render({});
  assert.match(html, /<fieldset>/);
  assert.match(html, /<legend class="sr-only">Choose a delivery speed<\/legend>/);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  assert.equal((html.match(/name="delivery-tier"/g) ?? []).length, 3);
  for (const text of ["Cruise Mode", "₦200", "20–30 minutes", "Sharp Sharp", "₦300", "15–25 minutes", "Oya Now!", "₦400", "10–15 minutes", "No rush, we’re coming. Your order joins the next delivery batch."]) {
    assert.ok(html.includes(text), text);
  }
  assert.match(radio(html, "CRUISE"), /checked=""/);
  assert.doesNotMatch(radio(html, "SHARP"), /checked|disabled/);
  assert.match(html, /aria-describedby="delivery-tier-oya-details"/);
  assert.doesNotMatch(html, /\bdark:/);
});

test("an unavailable chosen speed is shown checked and marked unavailable with a note; the others stay choosable", () => {
  const html = render({ tiers: without("OYA"), selected: "OYA" });
  assert.match(radio(html, "OYA"), /checked=""/);
  assert.match(radio(html, "OYA"), /aria-disabled="true"/);
  // Not the disabled attribute: a checked, disabled radio makes Chrome and Safari skip the whole group on Tab.
  assert.doesNotMatch(radio(html, "OYA"), / disabled=""/, "the group stays reachable by keyboard");
  assert.match(html, /Oya Now! isn’t available right now\. Choose another speed\./);
  assert.doesNotMatch(radio(html, "SHARP"), /disabled/);
  assert.match(radio(render({ disabled: true }), "SHARP"), / disabled=""/, "locked while payment starts");
  assert.match(radio(render({ tiers: without("OYA"), selected: "OYA", disabled: true }), "OYA"), / disabled=""/, "every speed is locked while payment starts");
});

test("before the migration the selector offers Cruise Mode only, at ₦200", () => {
  const html = render({ tiers: fallbackQuoteSet().quotes });
  assert.equal((html.match(/type="radio"/g) ?? []).length, 1);
  assert.match(html, /Cruise Mode/);
  assert.match(html, /₦200/);
  assert.doesNotMatch(html, /Sharp Sharp|Oya Now!/);
});

test("each speed is named by its label and fee; its window, description and any note are read once, as its description", () => {
  const html = render({ tiers: without("OYA"), selected: "OYA" });
  for (const [tier, name, fee] of [["CRUISE", "Cruise Mode", "₦200"], ["SHARP", "Sharp Sharp", "₦300"], ["OYA", "Oya Now!", "Not available"]]) {
    const id = `delivery-tier-${tier.toLowerCase()}`;
    assert.match(radio(html, tier), new RegExp(`aria-labelledby="${id}-name ${id}-fee"`), tier);
    assert.match(radio(html, tier), new RegExp(`aria-describedby="${id}-details"`), tier);
    assert.ok(html.includes(`id="${id}-name" class="font-black leading-5">${name}</span>`), `${tier} name`);
    assert.ok(html.includes(`id="${id}-fee" class="text-sm font-black">${fee}</span>`), `${tier} fee`);
  }
  const oyaDetails = html.slice(html.indexOf('id="delivery-tier-oya-details"'));
  assert.match(oyaDetails.slice(0, oyaDetails.indexOf("</label>")), /10–15 minutes.*When you need it ASAP\..*Oya Now! isn’t available right now\. Choose another speed\./, "the note is part of the description");
});

// ---------------------------------------------------------------------------------------------------------------
// The checkout page's client, rendered with the speeds the server would pass.

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const ITEMS = [{ id: "line-1", quantity: 2, name: "Exercise book", imageUrl: null, category: "Academic Materials", unitPrice: 1_500, plate: null, options: null, problem: null }];
const SUBTOTAL = 3_000;
const naira = (amount: number) => `₦${amount.toLocaleString()}`;
/** Always open, so these tests pass at any hour; the closed case has its own test below. */
const ALWAYS_OPEN: OrderingClock = { hours: { opensAtMinute: 0, closesAtMinute: 1_440, days: [0, 1, 2, 3, 4, 5, 6] }, serverNow: Date.UTC(2026, 10, 7, 9) };
const checkout = (tiers: DeliveryTierQuote[], ordering: OrderingClock = ALWAYS_OPEN) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never },
  createElement(PathnameContext.Provider, { value: "/checkout" },
    createElement(CartExperience, null, createElement(CheckoutClient, { items: ITEMS, tiers, ordering, providerName: "Paystack" })))));
/** The opening tag of the Pay button(s): the desktop summary and the phone's sticky bar each have one. */
const payButtons = (html: string) => html.split("<button").slice(1).filter((chunk) => chunk.slice(0, chunk.indexOf("</button>")).includes("Pay ₦")).map((chunk) => chunk.slice(0, chunk.indexOf(">")));

test("checkout steps: 1 Delivery, 2 Delivery speed, 3 items; Cruise Mode is chosen and its fee is in the total", () => {
  const html = checkout(all);
  const at = ["checkout-delivery-heading", "checkout-speed-heading", "checkout-items-heading"].map((id) => html.indexOf(`id="${id}"`));
  assert.ok(at.every((index, i) => index > 0 && (i === 0 || index > at[i - 1])), `steps in order: ${at}`);
  const speed = html.slice(html.indexOf('<section id="checkout-speed"'), html.indexOf('<section id="checkout-items"'));
  assert.match(speed, /^<section id="checkout-speed" tabindex="-1" aria-labelledby="checkout-speed-heading"/, "focusable step that Continue and errors move to");
  assert.match(speed, /aria-hidden="true">2<\/span>/);
  assert.match(speed, />Delivery speed<\/h2>/);
  assert.match(speed, /Each speed has its own delivery fee\./);
  assert.equal((speed.match(/type="radio"/g) ?? []).length, 3);
  assert.match(radio(speed, "CRUISE"), /checked=""/);
  assert.match(speed, /<p class="sr-only" aria-live="polite"><\/p>/, "a polite region for the new total");
  assert.match(html.slice(html.indexOf('<section id="checkout-items"')), /aria-hidden="true">3<\/span>/);
  assert.ok(html.includes("Cruise Mode · 20–30 minutes"), "the summary names the speed and its window");
  assert.ok(html.includes(`>${naira(200)}</dd>`), "the summary's delivery fee");
  assert.ok(html.includes(`>${naira(SUBTOTAL + 200)}</dd>`), "the summary's total");
  const pay = payButtons(html);
  assert.equal(pay.length, 2);
  assert.ok(html.includes(`Pay ${naira(SUBTOTAL + 200)}`));
  for (const button of pay) assert.doesNotMatch(button, / disabled=""/, "Pay is ready; the location step is checked when it's pressed");
});

test("checkout has a promo code box; nothing is discounted until a code is applied", () => {
  const html = checkout(all);
  const section = html.slice(html.indexOf('<section id="checkout-promo"'), html.indexOf("</section>", html.indexOf('<section id="checkout-promo"')));
  assert.match(section, /^<section id="checkout-promo" tabindex="-1" aria-labelledby="checkout-promo-heading"/, "focusable, so a refused code can take the student there");
  assert.match(section, /<label for="checkout-promo-code" class="sr-only">Promo code<\/label>/);
  assert.match(section, /<button type="submit" disabled=""[^>]*>Apply<\/button>/, "Apply waits for a code");
  assert.match(section, /Promo codes come off your items\. Delivery is always paid\./);
  assert.doesNotMatch(html, /Promo · /, "no discount line in the totals yet");
  assert.ok(html.includes(`Pay ${naira(SUBTOTAL + 200)}`), "the total is unchanged");
});

test("outside ordering times checkout still shows everything, but both Pay buttons wait for opening", () => {
  const closedButtons = (html: string, label: string) => html.split("<button").slice(1).filter((chunk) => chunk.slice(0, chunk.indexOf("</button>")).includes(label));
  // Tuesday 10 November 2026, 7pm campus time (6pm UTC), on the default Monday–Friday, 8am–5pm.
  const evening = checkout(all, { hours: DEFAULT_ORDERING_HOURS, serverNow: Date.UTC(2026, 10, 10, 18) });
  const buttons = closedButtons(evening, "Ordering opens Wednesday at 8am");
  assert.equal(buttons.length, 2, "the desktop summary and the phone's sticky bar");
  for (const button of buttons) assert.match(button.slice(0, button.indexOf(">")), / disabled=""/);
  assert.equal(payButtons(evening).length, 0, "no Pay button while closed");
  assert.match(evening, /Ordering is closed right now\. We take orders Monday to Friday, 8am–5pm; your cart is saved, so come back Wednesday at 8am to pay\./);
  assert.ok(evening.includes(`>${naira(SUBTOTAL + 200)}</dd>`), "the total is still shown");
  assert.match(evening, /Use my live location/, "the delivery step still works");

  // Saturday 14 November, midday: closed for the weekend, opens Monday.
  assert.equal(closedButtons(checkout(all, { hours: DEFAULT_ORDERING_HOURS, serverNow: Date.UTC(2026, 10, 14, 11) }), "Ordering opens Monday at 8am").length, 2);
  // Monday 9 November, 10am campus time: open, Pay is back.
  assert.equal(payButtons(checkout(all, { hours: DEFAULT_ORDERING_HOURS, serverNow: Date.UTC(2026, 10, 9, 9) })).length, 2);
});

test("checkout before the migration: Cruise Mode only, ₦200, exactly as before tiers", () => {
  const html = checkout(fallbackQuoteSet().quotes);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 1);
  assert.match(radio(html, "CRUISE"), /checked=""/);
  assert.doesNotMatch(html, /Sharp Sharp|Oya Now!/);
  assert.ok(html.includes(`Pay ${naira(SUBTOTAL + 200)}`));
});

test("checkout with Cruise Mode off: nothing is chosen for the student, and Pay waits for a choice", () => {
  const html = checkout(without("CRUISE"));
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2, "Sharp Sharp and Oya Now!");
  assert.doesNotMatch(html, /checked=""/);
  assert.ok(html.includes(">Choose a speed</dd>"), "no fee is shown until a speed is chosen");
  assert.ok(html.includes("Choose a delivery speed to continue."));
  assert.ok(html.includes(`Pay ${naira(SUBTOTAL)}`), "no delivery fee is added before a speed is chosen");
  for (const button of payButtons(html)) assert.match(button, /disabled=""/);
});

test("checkout with every speed off: it says so, nothing can be paid, and nothing pretends to be free", () => {
  const html = checkout(quotesFromRows(APPROVED.map((row) => ({ ...row, enabled: false }))).quotes);
  assert.ok(html.includes("Delivery isn’t available right now. Please try again later. Nothing has been charged."));
  assert.equal((html.match(/type="radio"/g) ?? []).length, 0);
  assert.ok(html.includes(">Not available</dd>"));
  assert.doesNotMatch(html, /Choose a speed/);
  for (const button of payButtons(html)) assert.match(button, /disabled=""/);
});
