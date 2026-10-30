import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLabelIds, parseNamedInput, parseStockInput, slugify } from "./catalogue-admin";
import { toProductCard, type ProductCardRow } from "./card";
import { optionsText, stockShortfall } from "./variants";

test("slugs are readable and accent-free", () => {
  assert.equal(slugify("  Hoodies & Sweatshirts "), "hoodies-sweatshirts");
  assert.equal(slugify("Café Crème"), "cafe-creme");
  assert.equal(slugify("!!!"), "");
});

test("categories, subcategories and labels: a name is required on create, updates only change what is sent", () => {
  assert.deepEqual(parseNamedInput({ name: "  Phone   Accessories " }, { creating: true, kind: "Category" }), { ok: true, data: { name: "Phone Accessories", slug: "phone-accessories" } });
  assert.equal(parseNamedInput({}, { creating: true, kind: "Subcategory" }).ok, false);
  assert.equal(parseNamedInput({ name: "???" }, { creating: true, kind: "Label" }).ok, false);
  assert.equal(parseNamedInput({ name: "x".repeat(31) }, { creating: true, kind: "Label" }).ok, false);
  assert.deepEqual(parseNamedInput({ isActive: false }, { creating: false, kind: "Category" }), { ok: true, data: { isActive: false } });
  assert.equal(parseNamedInput({}, { creating: false, kind: "Category" }).ok, false);
});

test("display order, status, description and image are validated; labels ignore description and image", () => {
  for (const sortOrder of [-1, 1.5, 10000, "3"]) assert.equal(parseNamedInput({ sortOrder }, { creating: false, kind: "Category" }).ok, false);
  assert.deepEqual(parseNamedInput({ sortOrder: 4 }, { creating: false, kind: "Subcategory" }), { ok: true, data: { sortOrder: 4 } });
  assert.equal(parseNamedInput({ isActive: "yes" }, { creating: false, kind: "Label" }).ok, false);
  assert.equal(parseNamedInput({ description: "x".repeat(301) }, { creating: false, kind: "Category" }).ok, false);
  assert.deepEqual(parseNamedInput({ description: "  ", imageUrl: "" }, { creating: false, kind: "Category" }), { ok: true, data: { description: null, imageUrl: null } });
  // Not a category: the image is ignored, so there is nothing to change.
  assert.equal(parseNamedInput({ imageUrl: "https://example.com/x.jpg" }, { creating: false, kind: "Label" }).ok, false);
});

test("simple-product stock is blank or a whole number of 0 or more; labels are unique and limited", () => {
  for (const blank of [null, "", undefined]) assert.deepEqual(parseStockInput(blank), { ok: true, value: null });
  assert.deepEqual(parseStockInput(0), { ok: true, value: 0 });
  for (const bad of [-1, 2.5, "4", 1_000_001]) assert.equal(parseStockInput(bad).ok, false);
  assert.deepEqual(parseLabelIds(["a", "b", "a"]), { ok: true, value: ["a", "b"] });
  assert.deepEqual(parseLabelIds(undefined), { ok: true, value: [] });
  assert.equal(parseLabelIds([1]).ok, false);
  assert.equal(parseLabelIds(Array.from({ length: 11 }, (_, i) => `l${i}`)).ok, false);
});

test("stock shortfall: untracked never blocks, otherwise the quantity must fit", () => {
  assert.equal(stockShortfall(null, 99), null);
  assert.equal(stockShortfall(5, 5), null);
  assert.match(stockShortfall(0, 1) ?? "", /Out of stock/);
  assert.match(stockShortfall(2, 3) ?? "", /Only 2 left/);
});

test("stored order lines describe their options; other lines don't", () => {
  assert.equal(optionsText({ kind: "VARIANT", variantId: "v", sku: null, options: [{ name: "Colour", value: "Black" }, { name: "Size", value: "XL" }] }), "Colour: Black · Size: XL");
  assert.equal(optionsText({ kind: "PLATE" }), null);
  assert.equal(optionsText(null), null);
});

const row = (overrides: Partial<ProductCardRow> = {}): ProductCardRow => ({
  id: "p", name: "Hoodie", customerPrice: 9000, imageUrl: null, stockQuantity: null, category: { name: "Clothing" }, labels: [], variants: [], ...overrides,
});

test("cards: simple products use their price and stock; products with options show the cheapest buyable one", () => {
  assert.deepEqual(toProductCard(row({ labels: [{ label: { name: "New" } }, { label: { name: "Popular" } }] })), { id: "p", name: "Hoodie", customerPrice: 9000, imageUrl: null, category: { name: "Clothing" }, labels: ["New", "Popular"], hasOptions: false, priceVaries: false, outOfStock: false });
  assert.equal(toProductCard(row({ stockQuantity: 0 })).outOfStock, true);

  const card = toProductCard(row({ variants: [
    { price: 8000, stockQuantity: 0, status: "ACTIVE" },
    { price: 9500, stockQuantity: 3, status: "ACTIVE" },
    { price: 11000, stockQuantity: null, status: "ACTIVE" },
  ] }));
  assert.equal(card.customerPrice, 9500, "a sold-out option doesn't set the From price");
  assert.equal(card.hasOptions, true);
  assert.equal(card.priceVaries, true);
  assert.equal(card.outOfStock, false);
  assert.equal(toProductCard(row({ variants: [{ price: 8000, stockQuantity: 0, status: "ACTIVE" }] })).outOfStock, true);
});
