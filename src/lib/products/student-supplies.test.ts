import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidCustomerPrice } from "../catalogue-permissions";
import { STUDENT_SUPPLIES, confirmedWriteTarget, planStudentSupplies, type ExistingCatalogueProduct } from "./student-supplies";

const ids = { academic: "cat-academic", clothing: "cat-clothing" };
const existing = (change: Partial<ExistingCatalogueProduct>): ExistingCatalogueProduct => ({ id: "p", name: "x", slug: "x", categoryId: "cat-academic", status: "ACTIVE", customerPrice: 1, imageUrl: null, ...change });

test("the list matches the supplied price list exactly: 29 items, whole-naira prices, unique slugs", () => {
  assert.equal(STUDENT_SUPPLIES.length, 29);
  assert.equal(new Set(STUDENT_SUPPLIES.map((spec) => spec.slug)).size, 29);
  for (const spec of STUDENT_SUPPLIES) assert.ok(isValidCustomerPrice(spec.price), spec.name);
  const price = (name: string) => STUDENT_SUPPLIES.find((spec) => spec.name === name)?.price;
  assert.equal(price("8-in-1 Notebook"), 8_000, "kept exactly as supplied");
  assert.equal(price("60-Leaf Exercise Books (Dozen)"), 4_000);
  assert.equal(price("ID Card Logo and Case"), 700);
  assert.equal(price("Pant Trouser (Option 2)"), 10_000);
  assert.equal(STUDENT_SUPPLIES.some((spec) => /notebook/i.test(spec.name) && /short/i.test(spec.name)), false, "no short-notebook variants until their price is confirmed");
});

test("an empty catalogue: everything is created with its price, no image, and only the trousers hidden", () => {
  const plan = planStudentSupplies([], ids);
  assert.ok(plan.every((step) => step.action === "create"));
  const hidden = plan.filter((step) => step.action === "create" && step.data.status === "INACTIVE").map((step) => step.spec.name);
  assert.deepEqual(hidden, ["Pant Trouser (Option 1)", "Pant Trouser (Option 2)"]);
  for (const step of plan) {
    if (step.action !== "create") continue;
    assert.equal(step.data.imageUrl, null, `${step.spec.name}: no invented image`);
    assert.equal(step.data.customerPrice, step.spec.price);
    assert.equal(step.data.categoryId, step.spec.category === "clothing" ? "cat-clothing" : "cat-academic");
  }
  const lab = plan.find((step) => step.spec.name === "Lab Coat");
  assert.ok(lab?.action === "create" && lab.data.description === null, "no invented descriptions");
});

test("existing products are reused unchanged; a different price is a conflict, never an overwrite", () => {
  const plan = planStudentSupplies([
    existing({ id: "seed-product-pen", name: "Blue Ballpoint Pen", slug: "blue-ballpoint-pen", customerPrice: 300 }),
    existing({ id: "seed-product-file", name: "Project File", slug: "project-file", customerPrice: 400 }),
    existing({ id: "old-8", name: "8-in-1 Lecture Notebook", slug: "8-in-1-lecture-notebook", status: "INACTIVE", customerPrice: 0 }),
    existing({ id: "named-eraser", name: "eraser ", slug: "eraser-2", customerPrice: 100 }),
  ], ids);
  const step = (name: string) => plan.find((entry) => entry.spec.name === name)!;
  const pen = step("Blue Ballpoint Pen");
  assert.ok(pen.action === "conflict" && /₦300.*₦100/.test(pen.reason), "the live ₦300 pen is reported, not repriced");
  assert.equal(step("Project File").action, "reuse");
  assert.equal(step("8-in-1 Notebook").action, "conflict", "the older unpriced 8-in-1 record is matched, not duplicated");
  assert.ok(step("Eraser").action === "reuse", "matched by name, ignoring case and spaces");
  assert.equal(plan.filter((entry) => entry.action === "create").length, 25);
});

test("rerunning after applying creates nothing", () => {
  const firstRun = planStudentSupplies([], ids).flatMap((step) => (step.action === "create" ? [existing({ id: step.data.slug, ...step.data })] : []));
  const secondRun = planStudentSupplies(firstRun, ids);
  assert.ok(secondRun.every((step) => step.action === "reuse"));
});

test("writing needs the target database named on the command line", () => {
  const host = "ep-example-123.us-east-2.aws.neon.tech";
  assert.equal(confirmedWriteTarget(host, ["--apply"]), false);
  assert.equal(confirmedWriteTarget(host, ["--apply", "--database-host=ep-other.neon.tech"]), false);
  assert.equal(confirmedWriteTarget(host, ["--apply", `--database-host=${host}`]), true);
});
