import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { DeliveryTierSettings } from "./DeliveryTierSettings";
import { adminTierCards, type AdminTierCard, type AdminTierRow } from "../../lib/delivery-tier-admin-input";

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const render = (props: { editable: boolean; tiers: AdminTierCard[] }) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, createElement(DeliveryTierSettings, props)));

const updatedAt = new Date("2026-11-01T14:00:00.000Z");
const approved: AdminTierRow[] = [
  { tier: "CRUISE", fee: 200, enabled: true, etaMinMinutes: 20, etaMaxMinutes: 30, version: 1, updatedAt },
  { tier: "SHARP", fee: 300, enabled: true, etaMinMinutes: 15, etaMaxMinutes: 25, version: 1, updatedAt },
  { tier: "OYA", fee: 400, enabled: true, etaMinMinutes: 10, etaMaxMinutes: 15, version: 1, updatedAt },
];

/** Each tier's <section>, in page order. */
function cards(html: string) {
  return [...html.matchAll(/<section aria-labelledby="tier-([A-Z]+)-title"[\s\S]*?<\/section>/g)].map((match) => ({ tier: match[1], html: match[0] }));
}
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

test("three cards in the approved order, each with its fee, window, description and Enabled status", () => {
  const html = render({ editable: true, tiers: adminTierCards(approved) });
  const shown = cards(html);
  assert.deepEqual(shown.map((card) => card.tier), ["CRUISE", "SHARP", "OYA"]);
  const expected = [["Cruise Mode", "₦200", "20–30 minutes", "No rush, we’re coming."], ["Sharp Sharp", "₦300", "15–25 minutes", "Need it a little quicker?"], ["Oya Now!", "₦400", "10–15 minutes", "When you need it ASAP."]];
  shown.forEach((card, index) => {
    for (const text of [...expected[index], "Enabled", "Estimated delivery"]) assert.ok(card.html.includes(text), `${card.tier}: ${text}`);
    assert.doesNotMatch(card.html, /Disabled/);
    const fee = tags(card.html, "input").find((tag) => tag.includes(`id="tier-fee-${card.tier}"`));
    assert.ok(fee, `${card.tier} has its fee field`);
    assert.match(fee, new RegExp(`value="${expected[index][1].slice(1)}"`));
    assert.match(fee, /inputMode="numeric"/);
    const toggle = tags(card.html, "input").find((tag) => tag.includes('type="checkbox"'));
    assert.ok(toggle && /checked=""/.test(toggle), `${card.tier} switch is on`);
    assert.match(card.html, /Enabled \(offered at checkout\)/);
    assert.match(card.html, new RegExp(`for="tier-fee-${card.tier}"`), "the fee field has a label");
  });
  assert.ok(tags(html, "input").every((tag) => !/ disabled=""/.test(tag)), "editable: nothing disabled");
  assert.ok(tags(html, "button").every((tag) => !/ disabled=""/.test(tag)));
  assert.equal(tags(html, "button").length, 3, "one Save per tier");
  assert.doesNotMatch(html, /\bdark:/, "PackAM is always light");
});

test("read-only (before the database update): every field and button is disabled", () => {
  for (const tiers of [adminTierCards(approved), adminTierCards(null)]) {
    const html = render({ editable: false, tiers });
    const fields = [...tags(html, "input"), ...tags(html, "button")];
    assert.equal(fields.length, 9, "three fee fields, three switches, three Save buttons");
    for (const tag of fields) assert.match(tag, / disabled=""/, tag);
  }
  const fallback = cards(render({ editable: false, tiers: adminTierCards(null) }));
  assert.deepEqual(fallback.map((card) => [card.tier, /Enabled<\/span>/.test(card.html), card.html.includes("No fee set")]), [["CRUISE", true, false], ["SHARP", false, true], ["OYA", false, true]], "Cruise Mode only, as checkout offers it then");
  assert.ok(fallback[0].html.includes("₦200") && fallback.every((card) => card.html.includes("Can be changed after the database update.")));
});

test("a tier that is off shows Disabled and an unticked switch; a card without a settings row can't be edited", () => {
  const html = render({ editable: true, tiers: adminTierCards([approved[0], { ...approved[1], enabled: false }]) });
  const [cruise, sharp, oya] = cards(html);
  assert.match(sharp.html, />Disabled</);
  assert.ok(!/checked=""/.test(tags(sharp.html, "input").find((tag) => tag.includes('type="checkbox"')) ?? ""), "switch off");
  assert.ok(tags(cruise.html, "input").every((tag) => !/ disabled=""/.test(tag)));
  assert.ok([...tags(oya.html, "input"), ...tags(oya.html, "button")].every((tag) => / disabled=""/.test(tag)), "no OYA row: read-only");
  assert.match(oya.html, /no settings row in the database/);
});
