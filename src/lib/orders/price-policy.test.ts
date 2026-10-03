import assert from "node:assert/strict";
import { test } from "node:test";
import { isPriceIncreaseWithinConfiguredTolerance } from "./price-policy";

test("decreases and unchanged prices are accepted without tolerance configuration", () => {
  assert.equal(isPriceIncreaseWithinConfiguredTolerance(1000, 900, {}), true);
  assert.equal(isPriceIncreaseWithinConfiguredTolerance(1000, 1000, {}), true);
});

test("price increases require approval unless configured thresholds allow them", () => {
  assert.equal(isPriceIncreaseWithinConfiguredTolerance(1000, 1010, {}), false);
  assert.equal(isPriceIncreaseWithinConfiguredTolerance(1000, 1010, { PRICE_CHANGE_TOLERANCE_AMOUNT: "15" }), true);
  assert.equal(isPriceIncreaseWithinConfiguredTolerance(1000, 1100, { PRICE_CHANGE_TOLERANCE_AMOUNT: "15" }), false);
  assert.equal(isPriceIncreaseWithinConfiguredTolerance(1000, 1050, { PRICE_CHANGE_TOLERANCE_PERCENT: "5" }), true);
});

test("invalid tolerance settings never silently approve an increase", () => {
  assert.equal(isPriceIncreaseWithinConfiguredTolerance(1000, 1001, { PRICE_CHANGE_TOLERANCE_AMOUNT: "-1" }), false);
  assert.equal(isPriceIncreaseWithinConfiguredTolerance(1000, 1001, { PRICE_CHANGE_TOLERANCE_PERCENT: "oops" }), false);
});
