import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_EXTRA_QUANTITY, describeDetails, parseLineDetails, plateConfigKey, priceLine, storedLineRequest, type MenuItem } from "./plate";
import { addConflict, cartContext, isMixedCart } from "./cart-context";

// A shop's menu as an admin might configure it. Names and prices are test fixtures, not real data.
const menu: MenuItem[] = [
  { id: "meal-jollof", name: "Jollof combo", role: "MEAL", price: 1500, available: true, maxPerPlate: null },
  { id: "base-rice", name: "White rice", role: "BASE", price: 500, available: true, maxPerPlate: null },
  { id: "base-amala", name: "Amala", role: "BASE", price: 400, available: true, maxPerPlate: null },
  { id: "soup-ewedu", name: "Ewedu", role: "SOUP", price: 200, available: true, maxPerPlate: null },
  { id: "soup-off", name: "Egusi", role: "SOUP", price: 300, available: false, maxPerPlate: null },
  { id: "extra-meat", name: "Meat", role: "EXTRA", price: 300, available: true, maxPerPlate: null },
  { id: "extra-ponmo", name: "Ponmo", role: "EXTRA", price: 150, available: true, maxPerPlate: 2 },
  { id: "extra-egg", name: "Egg", role: "EXTRA", price: 250, available: false, maxPerPlate: null },
];

test("a ready-made meal is priced at its fixed price times quantity", () => {
  const result = priceLine(menu, { kind: "MEAL", productId: "meal-jollof", quantity: 3 });
  assert.ok(result.ok);
  assert.deepEqual([result.line.unitPrice, result.line.total, result.line.configKey, result.line.extras], [1500, 4500, "", []]);
  assert.equal(describeDetails(result.line.details), "Jollof combo");
});

test("a built plate is base + soup + each extra × its quantity", () => {
  const result = priceLine(menu, { kind: "PLATE", baseId: "base-amala", soupId: "soup-ewedu", extras: [{ productId: "extra-meat", quantity: 2 }, { productId: "extra-ponmo", quantity: 1 }], quantity: 2 });
  assert.ok(result.ok);
  assert.equal(result.line.unitPrice, 400 + 200 + 2 * 300 + 150);
  assert.equal(result.line.total, 2 * 1350);
  assert.equal(result.line.productId, "base-amala", "the cart line is the base");
  assert.deepEqual(result.line.extras, [{ productId: "soup-ewedu", quantity: 1 }, { productId: "extra-meat", quantity: 2 }, { productId: "extra-ponmo", quantity: 1 }]);
  assert.equal(describeDetails(result.line.details), "Amala + Ewedu + Meat ×2 + Ponmo");
  const plain = priceLine(menu, { kind: "PLATE", baseId: "base-rice", quantity: 1 });
  assert.ok(plain.ok && plain.line.unitPrice === 500, "soup and extras are optional");
});

test("invalid or unavailable choices are refused with a reason, never priced", () => {
  const refuse = (request: Parameters<typeof priceLine>[1], pattern: RegExp) => {
    const result = priceLine(menu, request);
    assert.ok(!result.ok, JSON.stringify(request));
    assert.match(result.error, pattern);
  };
  refuse({ kind: "MEAL", productId: "base-rice", quantity: 1 }, /meal isn’t available/);
  refuse({ kind: "MEAL", productId: "other-shop-item", quantity: 1 }, /meal isn’t available/);
  refuse({ kind: "PLATE", baseId: "meal-jollof", quantity: 1 }, /Choose a base/);
  refuse({ kind: "PLATE", baseId: "base-rice", soupId: "soup-off", quantity: 1 }, /soup isn’t available/);
  refuse({ kind: "PLATE", baseId: "base-rice", soupId: "extra-meat", quantity: 1 }, /soup isn’t available/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-egg", quantity: 1 }], quantity: 1 }, /isn’t available/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "soup-ewedu", quantity: 1 }], quantity: 1 }, /isn’t available/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 1 }, { productId: "extra-meat", quantity: 2 }], quantity: 1 }, /listed twice/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 0 }], quantity: 1 }, /up to 5 times/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 1.5 }], quantity: 1 }, /up to 5 times/);
  refuse({ kind: "MEAL", productId: "meal-jollof", quantity: 0 }, /quantity from 1 to 99/);
  refuse({ kind: "MEAL", productId: "meal-jollof", quantity: 100 }, /quantity from 1 to 99/);
});

test("extras: at most 5 each, or the admin's lower limit", () => {
  assert.equal(MAX_EXTRA_QUANTITY, 5);
  assert.ok(priceLine(menu, { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 5 }], quantity: 1 }).ok);
  const six = priceLine(menu, { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 6 }], quantity: 1 });
  assert.ok(!six.ok && /Meat up to 5 times/.test(six.error));
  const ponmo = priceLine(menu, { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-ponmo", quantity: 3 }], quantity: 1 });
  assert.ok(!ponmo.ok && /Ponmo up to 2 times/.test(ponmo.error), "admin lowered ponmo to 2");
  const generous = priceLine([{ ...menu[5], maxPerPlate: 9 }, menu[1]], { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 6 }], quantity: 1 });
  assert.ok(!generous.ok, "never above 5, whatever is stored");
});

test("identical plates share a key (choices in any order); different plates don't", () => {
  const a = plateConfigKey("soup-ewedu", [{ productId: "extra-meat", quantity: 2 }, { productId: "extra-ponmo", quantity: 1 }]);
  const b = plateConfigKey("soup-ewedu", [{ productId: "extra-ponmo", quantity: 1 }, { productId: "extra-meat", quantity: 2 }]);
  assert.equal(a, b);
  for (const other of [
    plateConfigKey(null, [{ productId: "extra-meat", quantity: 2 }, { productId: "extra-ponmo", quantity: 1 }]),
    plateConfigKey("soup-ewedu", [{ productId: "extra-meat", quantity: 1 }, { productId: "extra-ponmo", quantity: 1 }]),
    plateConfigKey("soup-ewedu", [{ productId: "extra-meat", quantity: 2 }]),
  ]) assert.notEqual(a, other);
});

test("a stored cart line re-prices to the same plate from the current menu", () => {
  const stored = storedLineRequest({ productId: "base-amala", quantity: 2, productRole: "BASE", extras: [{ productId: "soup-ewedu", quantity: 1, role: "SOUP" }, { productId: "extra-meat", quantity: 2, role: "EXTRA" }] });
  assert.deepEqual(stored, { kind: "PLATE", baseId: "base-amala", soupId: "soup-ewedu", extras: [{ productId: "extra-meat", quantity: 2 }], quantity: 2 });
  const repriced = priceLine(menu.map((item) => (item.id === "extra-meat" ? { ...item, price: 350 } : item)), stored);
  assert.ok(repriced.ok && repriced.line.unitPrice === 400 + 200 + 700, "a menu price change shows up when the cart is priced again");
  assert.deepEqual(storedLineRequest({ productId: "meal-jollof", quantity: 1, productRole: "MEAL", extras: [] }), { kind: "MEAL", productId: "meal-jollof", quantity: 1 });
});

test("frozen details round-trip; anything else is rejected", () => {
  const result = priceLine(menu, { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 1 }], quantity: 1 });
  assert.ok(result.ok);
  assert.deepEqual(parseLineDetails(JSON.parse(JSON.stringify(result.line.details))), result.line.details);
  for (const bad of [null, "plate", { kind: "PLATE" }, { kind: "OTHER" }, [1]]) assert.equal(parseLineDetails(bad), null);
});

test("cart boundaries: Order Stuff or one food shop, never mixed, never silently merged", () => {
  const stuff = { product: { shopId: null } };
  const fromA = { product: { shopId: "shop-a", shop: { name: "Mama A" } } };
  const fromB = { product: { shopId: "shop-b", shop: { name: "Mama B" } } };
  assert.deepEqual(cartContext([]), { kind: "empty" });
  assert.deepEqual(cartContext([stuff]), { kind: "stuff" });
  assert.deepEqual(cartContext([fromA]), { kind: "food", shopId: "shop-a", shopName: "Mama A" });

  const shopA = { shopId: "shop-a", shopName: "Mama A" };
  const shopB = { shopId: "shop-b", shopName: "Mama B" };
  assert.equal(addConflict({ kind: "empty" }, shopA), null);
  assert.equal(addConflict({ kind: "empty" }, null), null);
  assert.equal(addConflict(cartContext([fromA]), shopA), null, "more from the same shop");
  assert.equal(addConflict(cartContext([stuff]), null), null, "more Order Stuff");
  assert.match(addConflict(cartContext([fromA]), shopB)!.message, /food from Mama A.*One food order comes from one shop/);
  assert.match(addConflict(cartContext([stuff]), shopA)!.message, /Order Stuff.*clear your cart to order from Mama A/);
  assert.match(addConflict(cartContext([fromA]), null)!.message, /food from Mama A.*checked out separately/);
  assert.equal(isMixedCart([fromA, fromB]), true);
  assert.equal(isMixedCart([fromA, stuff]), true);
  assert.equal(isMixedCart([fromA, fromA]), false);
});
