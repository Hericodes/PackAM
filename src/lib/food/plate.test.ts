import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_DISTINCT_BASES, MAX_EXTRA_QUANTITY, describeDetails, hasExtraLimit, portionUnit, foodPriceLabel, isSellablePrice, parseLineDetails, plateConfigKey, priceLine, soupRule, storedLineRequest, type MenuItem } from "./plate";
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
  refuse({ kind: "PLATE", baseId: "meal-jollof", quantity: 1 }, /Choose your plate from this shop’s menu/);
  refuse({ kind: "PLATE", baseId: "base-rice", soupId: "soup-off", quantity: 1 }, /soup isn’t available/);
  refuse({ kind: "PLATE", baseId: "base-rice", soupId: "extra-meat", quantity: 1 }, /soup isn’t available/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-egg", quantity: 1 }], quantity: 1 }, /isn’t available/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "soup-ewedu", quantity: 1 }], quantity: 1 }, /isn’t available/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 1 }, { productId: "extra-meat", quantity: 2 }], quantity: 1 }, /listed twice/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 0 }], quantity: 1 }, /how many Meat you want, from 1 to 99/);
  refuse({ kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 1.5 }], quantity: 1 }, /how many Meat you want/);
  refuse({ kind: "MEAL", productId: "meal-jollof", quantity: 0 }, /quantity from 1 to 99/);
  refuse({ kind: "MEAL", productId: "meal-jollof", quantity: 100 }, /quantity from 1 to 99/);
});

test("add-ons: as many as the student wants (safety ceiling 99), unless the admin set a limit", () => {
  assert.equal(MAX_EXTRA_QUANTITY, 99);
  const lots = priceLine(menu, { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 12 }], quantity: 1 });
  assert.ok(lots.ok && lots.line.unitPrice === 500 + 12 * 300, "12 meat on one plate is fine");
  assert.equal(describeDetails(lots.line.details), "White rice + Meat ×12");
  assert.ok(priceLine(menu, { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 99 }], quantity: 1 }).ok);
  const over = priceLine(menu, { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 100 }], quantity: 1 });
  assert.ok(!over.ok && /from 1 to 99 per plate\. For more, add another plate\./.test(over.error));
  const ponmo = priceLine(menu, { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-ponmo", quantity: 3 }], quantity: 1 });
  assert.ok(!ponmo.ok && /Ponmo up to 2 times/.test(ponmo.error), "the admin limited ponmo to 2");
  assert.deepEqual([hasExtraLimit({ maxPerPlate: null }), hasExtraLimit({ maxPerPlate: 2 }), hasExtraLimit({ maxPerPlate: 99 })], [false, true, false]);
  const stored = priceLine([{ ...menu[5], maxPerPlate: 500 }, menu[1]], { kind: "PLATE", baseId: "base-rice", extras: [{ productId: "extra-meat", quantity: 100 }], quantity: 1 });
  assert.ok(!stored.ok, "never above 99, whatever is stored");
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
  assert.deepEqual(stored, { kind: "PLATE", bases: [{ productId: "base-amala", quantity: 1 }], soupId: "soup-ewedu", extras: [{ productId: "extra-meat", quantity: 2 }], quantity: 2 });
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

// The same shop after its admin grouped everything, with a free soup.
const grouped: MenuItem[] = [
  { id: "amala", name: "Amala", role: "BASE", group: "SWALLOW", price: 400, available: true, maxPerPlate: null },
  { id: "jollof", name: "Jollof rice", role: "BASE", group: "RICE", price: 500, available: true, maxPerPlate: null },
  { id: "beans", name: "Beans", role: "BASE", group: "OTHER", price: 300, available: true, maxPerPlate: null },
  { id: "legacy", name: "Old base", role: "BASE", price: 350, available: true, maxPerPlate: null },
  { id: "ewedu", name: "Ewedu", role: "SOUP", price: 0, available: true, maxPerPlate: null },
  { id: "egusi", name: "Egusi", role: "SOUP", price: 200, available: true, maxPerPlate: null },
  { id: "beef", name: "Beef", role: "EXTRA", group: "PROTEIN", price: 300, available: true, maxPerPlate: null },
  { id: "plantain", name: "Plantain", role: "EXTRA", group: "SIDE", price: 200, available: true, maxPerPlate: null },
  { id: "coke", name: "Coke", role: "EXTRA", group: "DRINK", price: 400, available: true, maxPerPlate: 2 },
];

test("swallow needs a soup (free soups cost nothing); rice and others take none; ungrouped bases keep the old rule", () => {
  assert.deepEqual(["SWALLOW", "RICE", "OTHER", null, undefined].map((group) => soupRule({ group: group as never })), ["required", "none", "none", "optional", "optional"]);
  const noSoup = priceLine(grouped, { kind: "PLATE", baseId: "amala", quantity: 1 });
  assert.ok(!noSoup.ok && /Choose a soup for your Amala\. Soup is free\./.test(noSoup.error));
  const free = priceLine(grouped, { kind: "PLATE", baseId: "amala", soupId: "ewedu", extras: [{ productId: "beef", quantity: 2 }], quantity: 1 });
  assert.ok(free.ok);
  assert.equal(free.line.unitPrice, 400 + 0 + 600, "a free soup adds nothing");
  assert.equal(describeDetails(free.line.details), "Amala + Ewedu + Beef ×2");
  const paidSoup = priceLine(grouped, { kind: "PLATE", baseId: "amala", soupId: "egusi", quantity: 1 });
  assert.ok(paidSoup.ok && paidSoup.line.unitPrice === 600, "an admin may still price a special soup");
  const riceWithSoup = priceLine(grouped, { kind: "PLATE", baseId: "jollof", soupId: "ewedu", quantity: 1 });
  assert.ok(!riceWithSoup.ok && /Jollof rice doesn’t come with soup/.test(riceWithSoup.error));
  const rice = priceLine(grouped, { kind: "PLATE", baseId: "jollof", extras: [{ productId: "plantain", quantity: 1 }, { productId: "coke", quantity: 2 }], quantity: 2 });
  assert.ok(rice.ok && rice.line.unitPrice === 500 + 200 + 800 && rice.line.total === 3000);
  assert.ok(priceLine(grouped, { kind: "PLATE", baseId: "beans", quantity: 1 }).ok, "others: no soup, no protein needed");
  assert.ok(priceLine(grouped, { kind: "PLATE", baseId: "legacy", quantity: 1 }).ok, "an ungrouped base still works without soup");
  assert.ok(priceLine(grouped, { kind: "PLATE", baseId: "legacy", soupId: "ewedu", quantity: 1 }).ok, "and with one");
  const tooMany = priceLine(grouped, { kind: "PLATE", baseId: "jollof", extras: [{ productId: "coke", quantity: 3 }], quantity: 1 });
  assert.ok(!tooMany.ok && /Coke up to 2 times/.test(tooMany.error));
});

test("only soups may be free; the label says so", () => {
  assert.equal(isSellablePrice("SOUP", 0), true);
  for (const role of ["MEAL", "BASE", "EXTRA"] as const) assert.equal(isSellablePrice(role, 0), false, role);
  assert.equal(isSellablePrice("SOUP", -1), false);
  assert.equal(isSellablePrice("BASE", 1.5), false);
  assert.equal(priceLine([{ ...grouped[6], price: 0 }, grouped[1]], { kind: "PLATE", baseId: "jollof", extras: [{ productId: "beef", quantity: 1 }], quantity: 1 }).ok, false, "a ₦0 add-on is never sold");
  assert.equal(foodPriceLabel(0), "Free");
  assert.equal(foodPriceLabel(1500), "₦1,500");
});

test("a plate can mix items, each by the spoon (or wrap), priced per spoon", () => {
  const mixed = priceLine(grouped, { kind: "PLATE", bases: [{ productId: "jollof", quantity: 2 }, { productId: "beans", quantity: 1 }], extras: [{ productId: "beef", quantity: 3 }], quantity: 1 });
  assert.ok(mixed.ok);
  assert.equal(mixed.line.unitPrice, 2 * 500 + 300 + 3 * 300, "2 spoons of jollof + 1 of beans + 3 beef");
  assert.equal(mixed.line.name, "Jollof rice + Beans");
  assert.equal(describeDetails(mixed.line.details), "Jollof rice ×2 + Beans + Beef ×3");
  assert.equal(mixed.line.productId, "beans", "the cart line belongs to the first item by id, whatever order they were picked in");
  assert.deepEqual(mixed.line.extras, [{ productId: "jollof", quantity: 2 }, { productId: "beans", quantity: 1 }, { productId: "beef", quantity: 3 }], "every item is stored with its spoons");
  const sameOtherOrder = priceLine(grouped, { kind: "PLATE", bases: [{ productId: "beans", quantity: 1 }, { productId: "jollof", quantity: 2 }], extras: [{ productId: "beef", quantity: 3 }], quantity: 1 });
  assert.ok(sameOtherOrder.ok && sameOtherOrder.line.configKey === mixed.line.configKey, "the same plate picked in another order merges in the cart");
  const fewerSpoons = priceLine(grouped, { kind: "PLATE", bases: [{ productId: "jollof", quantity: 1 }, { productId: "beans", quantity: 1 }], extras: [{ productId: "beef", quantity: 3 }], quantity: 1 });
  assert.ok(fewerSpoons.ok && fewerSpoons.line.configKey !== mixed.line.configKey, "a different number of spoons is a different plate");

  // Swallow by the wrap, with several swallows together and a soup.
  const wraps = priceLine(grouped, { kind: "PLATE", bases: [{ productId: "amala", quantity: 3 }], soupId: "ewedu", quantity: 1 });
  assert.ok(wraps.ok && wraps.line.unitPrice === 3 * 400 && describeDetails(wraps.line.details) === "Amala ×3 + Ewedu");
  assert.deepEqual([portionUnit("SWALLOW"), portionUnit("SWALLOW", 3), portionUnit("RICE"), portionUnit("OTHER", 2), portionUnit(null)], ["wrap", "wraps", "spoon", "spoons", "spoon"]);
});

test("one spoon of one item is stored and keyed exactly as before mixing existed", () => {
  const viaBases = priceLine(grouped, { kind: "PLATE", bases: [{ productId: "jollof", quantity: 1 }], extras: [{ productId: "beef", quantity: 1 }], quantity: 2 });
  const viaBaseId = priceLine(grouped, { kind: "PLATE", baseId: "jollof", extras: [{ productId: "beef", quantity: 1 }], quantity: 2 });
  assert.ok(viaBases.ok && viaBaseId.ok);
  assert.deepEqual(viaBases.line, viaBaseId.line, "an old checkout tab and the new menu make the same line");
  assert.equal(viaBases.line.configKey, plateConfigKey(null, [{ productId: "beef", quantity: 1 }]), "the old key");
  assert.deepEqual(viaBases.line.extras, [{ productId: "beef", quantity: 1 }], "no extra rows for the item itself");
  assert.equal(viaBases.line.details.kind === "PLATE" && viaBases.line.details.bases, undefined, "details look like before");
  // A stored mixed plate comes back as the same request.
  const mixed = priceLine(grouped, { kind: "PLATE", bases: [{ productId: "jollof", quantity: 2 }, { productId: "beans", quantity: 1 }], quantity: 1 });
  assert.ok(mixed.ok);
  const roles = new Map(grouped.map((item) => [item.id, item.role]));
  const back = storedLineRequest({ productId: mixed.line.productId, quantity: 1, productRole: "BASE", extras: mixed.line.extras.map((row) => ({ ...row, role: roles.get(row.productId)! })) });
  const again = priceLine(grouped, back);
  assert.ok(again.ok && again.line.configKey === mixed.line.configKey && again.line.unitPrice === mixed.line.unitPrice);
});

test("mixing rules: swallow on its own plate; at most 3 different items; spoons from 1 to 99", () => {
  const refuse = (request: Parameters<typeof priceLine>[1], pattern: RegExp) => {
    const result = priceLine(grouped, request);
    assert.ok(!result.ok && pattern.test(result.error), `${JSON.stringify(request)} → ${result.ok ? "ok" : result.error}`);
  };
  refuse({ kind: "PLATE", bases: [{ productId: "amala", quantity: 1 }, { productId: "jollof", quantity: 1 }], soupId: "ewedu", quantity: 1 }, /Swallow comes on its own plate with soup\. Put Jollof rice on another plate\./);
  refuse({ kind: "PLATE", bases: [{ productId: "jollof", quantity: 1 }, { productId: "beans", quantity: 1 }], soupId: "ewedu", quantity: 1 }, /These don’t come with soup/);
  refuse({ kind: "PLATE", bases: [{ productId: "amala", quantity: 2 }], quantity: 1 }, /Choose a soup for your Amala/);
  refuse({ kind: "PLATE", bases: [], quantity: 1 }, /Choose what you want on your plate/);
  refuse({ kind: "PLATE", bases: [{ productId: "jollof", quantity: 0 }], quantity: 1 }, /how many spoons of Jollof rice/);
  refuse({ kind: "PLATE", bases: [{ productId: "amala", quantity: 100 }], soupId: "ewedu", quantity: 1 }, /how many wraps of Amala you want, from 1 to 99/);
  refuse({ kind: "PLATE", bases: [{ productId: "jollof", quantity: 1 }, { productId: "jollof", quantity: 2 }], quantity: 1 }, /listed twice\. Set how many spoons/);
  const four = [...grouped.filter((item) => item.role === "BASE" && item.group !== "SWALLOW"), { id: "spag", name: "Spaghetti", role: "BASE" as const, group: "OTHER" as const, price: 300, available: true, maxPerPlate: null }];
  const tooMany = priceLine([...grouped, four[3]], { kind: "PLATE", bases: four.map((item) => ({ productId: item.id, quantity: 1 })), quantity: 1 });
  assert.ok(!tooMany.ok && new RegExp(`up to ${MAX_DISTINCT_BASES} different items`).test(tooMany.error));
  // Several swallows together are fine.
  const eba = { id: "eba", name: "Eba", role: "BASE" as const, group: "SWALLOW" as const, price: 200, available: true, maxPerPlate: null };
  const two = priceLine([...grouped, eba], { kind: "PLATE", bases: [{ productId: "amala", quantity: 1 }, { productId: "eba", quantity: 2 }], soupId: "ewedu", quantity: 1 });
  assert.ok(two.ok && two.line.unitPrice === 400 + 400);
});

test("the longest possible plate key fits the database limit", () => {
  const id = (n: number) => `c${String(n).padStart(24, "0")}`;
  const key = plateConfigKey(id(0), Array.from({ length: 12 }, (_, i) => ({ productId: id(i + 1), quantity: 99 })), Array.from({ length: MAX_DISTINCT_BASES }, (_, i) => ({ productId: id(i + 20), quantity: 99 })));
  assert.ok(key.length <= 500, `${key.length} characters`);
});
