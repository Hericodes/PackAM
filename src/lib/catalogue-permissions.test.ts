import assert from "node:assert/strict";
import { test } from "node:test";
import { canManageCatalogue, isValidCustomerPrice, isValidReportedShopPrice } from "./catalogue-permissions";

test("only admins can manage the catalogue", () => {
  assert.equal(canManageCatalogue("ADMIN"), true);
  for (const role of ["RUNNER", "STUDENT", "admin", "", null, undefined]) {
    assert.equal(canManageCatalogue(role), false, String(role));
  }
});

test("customer prices must be whole, positive naira amounts", () => {
  assert.equal(isValidCustomerPrice(1), true);
  assert.equal(isValidCustomerPrice(2_500), true);
  for (const value of [0, -100, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "500", null, undefined, 2 ** 60]) {
    assert.equal(isValidCustomerPrice(value), false, String(value));
  }
});

test("runner-reported shop prices must be whole, positive amounts", () => {
  assert.equal(isValidReportedShopPrice(700), true);
  for (const value of [0, -1, 99.9, "700"]) assert.equal(isValidReportedShopPrice(value), false, String(value));
});
