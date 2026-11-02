import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePrintPrice, parsePageSelection } from "./pricing";

test("A4 black-and-white prices every selected printed page and adds the delivery fee", () => {
  const selection = parsePageSelection("1-5, 8, 10-12", 12);
  assert.deepEqual(selection, { canonical: "1-5, 8, 10-12", selectedPageCount: 9 });
  assert.deepEqual(calculatePrintPrice({
    selectedPageCount: selection.selectedPageCount,
    copies: 2,
    paperSize: "A4",
    colorMode: "BLACK_AND_WHITE",
    sides: "SINGLE",
  }), {
    currency: "NGN",
    pricingVersion: "2026-10-04",
    ratePerPage: 100,
    selectedPageCount: 9,
    copies: 2,
    printSubtotal: 1800,
    deliveryFee: 200,
    total: 2000,
  });
});

test("A4 color uses its configured rate and double-sided printing is still priced per printed page", () => {
  const price = calculatePrintPrice({
    selectedPageCount: 10,
    copies: 3,
    paperSize: "A4",
    colorMode: "COLOR",
    sides: "DOUBLE",
  });
  assert.equal(price.ratePerPage, 300);
  assert.equal(price.printSubtotal, 9000);
  assert.equal(price.total, 9200);
});

test("all pages and single-page selections are canonicalized", () => {
  assert.deepEqual(parsePageSelection("all", 5), { canonical: "ALL", selectedPageCount: 5 });
  assert.deepEqual(parsePageSelection(" 4 ", 5), { canonical: "4", selectedPageCount: 1 });
});

test("invalid, repeated, descending, out-of-range, and empty page selections are rejected", () => {
  for (const value of ["", "0", "5-2", "1-6", "1, 1", "2-4, 4-5", "one"]) {
    assert.throws(() => parsePageSelection(value, 5));
  }
});

test("invalid page counts and copy quantities are rejected", () => {
  assert.throws(() => parsePageSelection("ALL", 0));
  assert.throws(() => parsePageSelection("ALL", 501));
  for (const copies of [0, -1, 21, 1.5]) {
    assert.throws(() => calculatePrintPrice({
      selectedPageCount: 1,
      copies,
      paperSize: "A4",
      colorMode: "BLACK_AND_WHITE",
      sides: "SINGLE",
    }));
  }
});

import { readFileSync } from "node:fs";
import { PRINT_DELIVERY_FEE } from "./pricing";

test("printing keeps its own ₦200 delivery fee, independent of delivery tiers", () => {
  assert.equal(PRINT_DELIVERY_FEE, 200);
  const price = calculatePrintPrice({ selectedPageCount: 5, copies: 2, paperSize: "A4", colorMode: "BLACK_AND_WHITE", sides: "DOUBLE" });
  assert.equal(price.deliveryFee, PRINT_DELIVERY_FEE);
  assert.equal(price.total, 1_000 + PRINT_DELIVERY_FEE);
  for (const path of ["./pricing.ts", "./payment-snapshot.ts", "../../app/printing/page.tsx"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /CHECKOUT_DELIVERY_FEE|DeliveryTier|deliveryTier/, `${path} must not read marketplace delivery pricing`);
  }
});
