import test from "node:test";
import assert from "node:assert/strict";
import { promoDiscountOf, summarizeKnownOrderMoney } from "./finance";

test("GMV is customer total while product sales and delivery remain separate", () => {
  const result = summarizeKnownOrderMoney([{ subtotal: 4800, deliveryFee: 200, total: 5000 }]);
  assert.deepEqual(result, { productSales: 4800, deliveryFees: 200, promoDiscounts: 0, gmv: 5000 });
  assert.notEqual(result.gmv, result.productSales);
});

test("finance summaries are deterministic integer sums", () => {
  assert.deepEqual(summarizeKnownOrderMoney([{ subtotal: 1200, deliveryFee: 150, total: 1350 }, { subtotal: 4800, deliveryFee: 200, total: 5000 }]), { productSales: 6000, deliveryFees: 350, promoDiscounts: 0, gmv: 6350 });
});

test("delivery tier fees are delivery revenue: any fee reconciles as long as subtotal + fee = total", () => {
  // A Sharp Sharp (₦300) and an Oya Now! (₦400) order.
  assert.deepEqual(summarizeKnownOrderMoney([{ subtotal: 1000, deliveryFee: 300, total: 1300 }, { subtotal: 500, deliveryFee: 400, total: 900 }]), { productSales: 1500, deliveryFees: 700, promoDiscounts: 0, gmv: 2200 });
});

test("a promo code comes off the items: total = subtotal + delivery - discount, reported as promo discounts", () => {
  // ₦1,000 off ₦5,000 of items with ₦200 delivery; a ₦2k code on ₦1,500 of items (₦1,500 off, delivery still paid).
  const result = summarizeKnownOrderMoney([{ subtotal: 5000, deliveryFee: 200, total: 4200 }, { subtotal: 1500, deliveryFee: 200, total: 200 }]);
  assert.deepEqual(result, { productSales: 6500, deliveryFees: 400, promoDiscounts: 2500, gmv: 4400 });
  assert.equal(promoDiscountOf({ subtotal: 5000, deliveryFee: 200, total: 4200 }), 1000);
  assert.equal(promoDiscountOf({ subtotal: 5000, deliveryFee: 200, total: 5200 }), 0);
});

test("mismatched or fractional stored totals are rejected", () => {
  assert.throws(() => summarizeKnownOrderMoney([{ subtotal: 1.5, deliveryFee: 0, total: 1.5 }]));
  assert.throws(() => summarizeKnownOrderMoney([{ subtotal: 100, deliveryFee: 20, total: 121 }]), "paid more than items + delivery");
  assert.throws(() => summarizeKnownOrderMoney([{ subtotal: 100, deliveryFee: 20, total: 19 }]), "a discount bigger than the items would have touched delivery");
});
