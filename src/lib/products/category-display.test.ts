import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryDisplay, productGlyph } from "./category-display";

test("products without photos get distinct illustrations from their own names", () => {
  assert.equal(productGlyph("Project File", "Academic Materials"), "📁");
  assert.equal(productGlyph("A4 Paper", "Academic Materials"), "📄");
  assert.equal(productGlyph("Exercise Book", "Academic Materials"), "📒");
  assert.equal(productGlyph("Blue Ballpoint Pen", "Academic Materials"), "🖊️");
  assert.equal(productGlyph("Campus Rice Meal", "Food & Drinks"), "🍛");
  assert.equal(productGlyph("Soft Drink", "Food & Drinks"), "🥤");
  assert.equal(productGlyph("Bottled Water", "Food & Drinks"), "💧");
  assert.equal(productGlyph("Indomie Noodles", "food-drinks"), "🍜");
});

test("unmatched names fall back to the category icon, and unknown categories to a neutral one", () => {
  assert.equal(productGlyph("Mystery Item", "Academic Materials"), categoryDisplay("academic-materials").icon);
  assert.equal(productGlyph("Profile Photo Print", "phones-accessories"), categoryDisplay("phones-accessories").icon, "'profile' must not match 'file'");
  assert.equal(productGlyph("Mystery Item", null), "🛍️");
});

test("every category resolves to a gradient tone by slug or display name", () => {
  assert.equal(categoryDisplay("Food & Drinks").tone, "peach");
  assert.equal(categoryDisplay("academic-materials").tone, "butter");
  assert.equal(categoryDisplay("unknown").tone, "cream");
});
