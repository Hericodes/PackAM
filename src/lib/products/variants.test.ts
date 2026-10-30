import assert from "node:assert/strict";
import { test } from "node:test";
import { describeOptions, generateCombinations, isBuyable, optionKeyFor, parseVariantDetails, parseVariantSetup, priceRange, selectableValues, variantConfigKey, variantFor, type ShopOption, type ShopVariant } from "./variants";

test("combinations: one value from each option, every pairing, none duplicated", () => {
  const combos = generateCombinations([{ values: ["S", "M", "L", "XL"] }, { values: ["Black", "White"] }]);
  assert.equal(combos.length, 8);
  assert.deepEqual(combos.slice(0, 3), [["S", "Black"], ["S", "White"], ["M", "Black"]]);
  assert.equal(new Set(combos.map((combo) => combo.join("/"))).size, 8);
  assert.deepEqual(generateCombinations([{ values: ["Cold", "Room temperature"] }]), [["Cold"], ["Room temperature"]]);
  assert.deepEqual(generateCombinations([]), []);
  assert.deepEqual(generateCombinations([{ values: [] }, { values: ["Black"] }]), [["Black"]], "an option without values is skipped");
  assert.equal(optionKeyFor(["b", "a"]), optionKeyFor(["a", "b"]), "the combination key ignores order");
});

const setup = (change: Record<string, unknown> = {}) => ({
  options: [
    { key: "o-size", name: "Size", values: [{ key: "v-s", value: "S" }, { key: "v-m", value: "M" }] },
    { key: "o-colour", name: "Colour", values: [{ key: "v-black", value: "Black" }, { key: "v-white", value: "White" }] },
  ],
  variants: [
    { valueKeys: ["v-s", "v-black"], price: 7000, stockQuantity: 3, sku: "DW-S-BLK", active: true, imageUrl: null },
    { valueKeys: ["v-s", "v-white"], price: 7000, stockQuantity: null, sku: null, active: true, imageUrl: null },
    { valueKeys: ["v-m", "v-black"], price: 7500, stockQuantity: 0, sku: null, active: true, imageUrl: null },
    { valueKeys: ["v-m", "v-white"], price: 7500, stockQuantity: null, sku: null, active: false, imageUrl: null },
  ],
  ...change,
});

test("admin setup: a valid multi-option product, and a simple product with no options", () => {
  const parsed = parseVariantSetup(setup());
  assert.ok(parsed.ok);
  assert.equal(parsed.data.variants.length, 4);
  assert.equal(parsed.data.variants[3].active, false, "a disabled combination is kept but not sold");
  assert.deepEqual(parseVariantSetup({ options: [], variants: [] }), { ok: true, data: { options: [], variants: [] } });
});

test("admin setup: every mistake is refused with a reason", () => {
  const error = (body: unknown) => { const result = parseVariantSetup(body); return result.ok ? "" : result.error; };
  const base = setup();
  assert.match(error({ ...base, options: [{ ...base.options[0], name: " " }, base.options[1]] }), /needs a name/);
  assert.match(error({ ...base, options: [base.options[0], { ...base.options[1], name: "size" }] }), /two option groups called/);
  assert.match(error({ ...base, options: [{ ...base.options[0], values: [] }, base.options[1]] }), /at least one value/);
  assert.match(error({ ...base, options: [{ ...base.options[0], values: [{ key: "a", value: "S" }, { key: "b", value: "s" }] }, base.options[1]] }), /lists “s” twice/);
  assert.match(error({ ...base, variants: [...base.variants, base.variants[0]] }), /Size: S · Colour: Black is listed twice/);
  assert.match(error({ ...base, variants: [{ ...base.variants[0], valueKeys: ["v-s"] }] }), /exactly one value from every option/);
  assert.match(error({ ...base, variants: [{ ...base.variants[0], valueKeys: ["v-s", "v-m"] }] }), /exactly one value from every option/);
  assert.match(error({ ...base, variants: [{ ...base.variants[0], price: 0 }] }), /at least ₦1/);
  assert.match(error({ ...base, variants: [{ ...base.variants[0], price: 99.5 }] }), /at least ₦1/);
  assert.match(error({ ...base, variants: [{ ...base.variants[0], stockQuantity: -1 }] }), /stock must be a whole number/);
  assert.match(error({ ...base, variants: [base.variants[0], { ...base.variants[1], sku: "dw-s-blk" }] }), /SKU “dw-s-blk” is used twice/);
  assert.match(error({ ...base, variants: base.variants.map((variant) => ({ ...variant, active: false })) }), /At least one variant must be available/);
  assert.match(error({ options: base.options, variants: [] }), /Add at least one variant/);
  assert.match(error({ options: [], variants: base.variants }), /need at least one option group/);
});

// Storefront: Departmental Wear with M/Black out of stock and M/White disabled.
const options: ShopOption[] = [
  { id: "size", name: "Size", values: [{ id: "s", value: "S" }, { id: "m", value: "M" }] },
  { id: "colour", name: "Colour", values: [{ id: "black", value: "Black" }, { id: "white", value: "White" }] },
];
const variants: ShopVariant[] = [
  { id: "sb", price: 7000, stockQuantity: 3, active: true, valueIds: ["s", "black"], imageUrl: null },
  { id: "sw", price: 7000, stockQuantity: null, active: true, valueIds: ["s", "white"], imageUrl: null },
  { id: "mb", price: 7500, stockQuantity: 0, active: true, valueIds: ["m", "black"], imageUrl: null },
  { id: "mw", price: 7500, stockQuantity: null, active: false, valueIds: ["m", "white"], imageUrl: null },
];

test("storefront: unavailable choices are disabled and only buyable combinations resolve", () => {
  assert.equal(isBuyable(variants[0]), true);
  assert.equal(isBuyable(variants[2]), false, "out of stock");
  assert.equal(isBuyable(variants[3]), false, "disabled by the admin");
  const nothingChosen = selectableValues(options, variants, {});
  assert.deepEqual([...nothingChosen.size], ["s"], "no M is buyable in any colour");
  assert.deepEqual([...nothingChosen.colour], ["black", "white"]);
  assert.deepEqual([...selectableValues(options, variants, { size: "s" }).colour], ["black", "white"]);
  assert.equal(variantFor(options, variants, { size: "s" }), null, "not chosen yet");
  assert.equal(variantFor(options, variants, { size: "s", colour: "white" })?.id, "sw");
  assert.equal(variantFor(options, variants, { size: "m", colour: "white" })?.id, "mw", "resolved, but the page treats it as unavailable");
  assert.deepEqual(priceRange(variants), { min: 7000, max: 7000 }, "From price uses buyable variants");
  assert.equal(priceRange([]), null);
});

test("order lines keep a readable copy of the options; cart lines are keyed per variant", () => {
  assert.equal(describeOptions([{ name: "Size", value: "XL" }, { name: "Colour", value: "White" }]), "Size: XL · Colour: White");
  const details = { kind: "VARIANT", variantId: "v1", sku: "DW-XL-WHT", options: [{ name: "Size", value: "XL" }] };
  assert.deepEqual(parseVariantDetails(JSON.parse(JSON.stringify(details))), details);
  for (const bad of [null, { kind: "PLATE" }, { kind: "VARIANT" }, "x"]) assert.equal(parseVariantDetails(bad), null);
  assert.notEqual(variantConfigKey("a"), variantConfigKey("b"));
});
