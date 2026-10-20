import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACADEMIC_CATEGORY, ACADEMIC_PRODUCTS, planAcademicProducts, type ExistingProduct } from "./academic-products";
import { PRICE_NOT_SET, activationBlocker, isPriceSet } from "../catalogue-permissions";
import { studentCatalogueProductWhere } from "./catalogue";
import { productGlyph } from "./category-display";
import { ProductVisual } from "../../components/products/ProductVisual";

const CATEGORY = "cat-academic";

test("the eight requested products, with unique slugs, in Academic Materials", () => {
  assert.deepEqual(ACADEMIC_PRODUCTS.map((p) => p.name), [
    "Blue Ballpoint Pen", "8-in-1 Lecture Notebook", "Single-Subject Exercise Book", "Project File",
    "A4 Paper", "Transparent Document File", "HB Pencil", "Highlighter",
  ]);
  const slugs = ACADEMIC_PRODUCTS.flatMap((p) => [p.slug, ...(p.aliasSlugs ?? [])]);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(ACADEMIC_CATEGORY.slug, "academic-materials", "the category the seed already uses");
});

test("new products invent nothing: inactive, price not set, no image, no description", () => {
  const plan = planAcademicProducts([], CATEGORY);
  assert.equal(plan.length, 8);
  for (const step of plan) {
    assert.equal(step.action, "create");
    if (step.action !== "create") continue;
    assert.deepEqual({ status: step.data.status, price: step.data.customerPrice, image: step.data.imageUrl, description: step.data.description, categoryId: step.data.categoryId }, { status: "INACTIVE", price: PRICE_NOT_SET, image: null, description: null, categoryId: CATEGORY });
    assert.equal(isPriceSet(step.data.customerPrice), false);
  }
});

test("existing products are reused, never duplicated, and keep their price, status and image", () => {
  const seeded: ExistingProduct[] = [
    { id: "p1", name: "Blue Ballpoint Pen", slug: "blue-ballpoint-pen", categoryId: CATEGORY, status: "ACTIVE", customerPrice: 200, imageUrl: "https://res.cloudinary.com/x/pen.jpg" },
    { id: "p2", name: "Exercise Book", slug: "exercise-book", categoryId: "cat-other", status: "INACTIVE", customerPrice: 700, imageUrl: null },
    { id: "p3", name: "hb pencil", slug: "pencil-hb-old", categoryId: CATEGORY, status: "INACTIVE", customerPrice: 0, imageUrl: null },
  ];
  const plan = planAcademicProducts(seeded, CATEGORY);
  const bySlug = Object.fromEntries(plan.map((step) => [step.spec.slug, step]));
  assert.deepEqual(bySlug["blue-ballpoint-pen"], { action: "reuse", spec: bySlug["blue-ballpoint-pen"].spec, existing: seeded[0], update: {} });
  const exercise = bySlug["single-subject-exercise-book"];
  assert.equal(exercise.action, "reuse", "the seed's exercise-book slug is the same item");
  assert.deepEqual(exercise.action === "reuse" && exercise.update, { name: "Single-Subject Exercise Book", categoryId: CATEGORY });
  assert.equal(bySlug["hb-pencil"].action, "reuse", "matched by name, case-insensitively");
  for (const step of plan) {
    if (step.action !== "reuse") continue;
    assert.ok(!("customerPrice" in step.update) && !("status" in step.update) && !("imageUrl" in step.update), "only name and category are ever aligned");
  }
  assert.equal(plan.filter((step) => step.action === "create").length, 5);
});

test("running the plan again changes nothing", () => {
  const firstRun = planAcademicProducts([], CATEGORY);
  const created: ExistingProduct[] = firstRun.flatMap((step, index) => step.action === "create" ? [{ id: `new-${index}`, ...step.data }] : []);
  const secondRun = planAcademicProducts(created, CATEGORY);
  assert.ok(secondRun.every((step) => step.action === "reuse" && Object.keys(step.update).length === 0));
});

test("an unpriced product can't be activated or appear in the student catalogue", () => {
  assert.match(activationBlocker(PRICE_NOT_SET) ?? "", /at least ₦1 before activating/);
  assert.equal(activationBlocker(250), null);
  assert.deepEqual(studentCatalogueProductWhere.customerPrice, { gte: 1 });
  assert.equal(studentCatalogueProductWhere.status, "ACTIVE");
});

test("products without a photo show a matching illustration, never a fake image", () => {
  for (const spec of ACADEMIC_PRODUCTS) {
    assert.notEqual(productGlyph(spec.name, "academic-materials"), "📚", `${spec.name} gets its own icon, not just the category one`);
  }
  assert.equal(productGlyph("Highlighter", "academic-materials"), "🖍️");
  const html = renderToStaticMarkup(createElement(ProductVisual, { name: "HB Pencil", imageUrl: null, category: "Academic Materials", sizes: "50vw" }));
  assert.doesNotMatch(html, /<img/i, "no placeholder image is requested");
  assert.match(html, /✏️/);
});
