import test from "node:test";
import assert from "node:assert/strict";
import { summarizeKnownOrderMoney } from "./finance";

test("GMV is customer total while product sales and delivery remain separate", () => {
  const result = summarizeKnownOrderMoney([{ subtotal: 4800, deliveryFee: 200, total: 5000 }]);
  assert.deepEqual(result, { productSales: 4800, deliveryFees: 200, gmv: 5000 });
  assert.notEqual(result.gmv, result.productSales);
});

test("finance summaries are deterministic integer sums", () => {
  assert.deepEqual(summarizeKnownOrderMoney([{ subtotal: 1200, deliveryFee: 150, total: 1350 }, { subtotal: 4800, deliveryFee: 200, total: 5000 }]), { productSales: 6000, deliveryFees: 350, gmv: 6350 });
});

test("mismatched or fractional stored totals are rejected", () => {
  assert.throws(() => summarizeKnownOrderMoney([{ subtotal: 1.5, deliveryFee: 0, total: 1.5 }]));
  assert.throws(() => summarizeKnownOrderMoney([{ subtotal: 100, deliveryFee: 20, total: 119 }]));
});
