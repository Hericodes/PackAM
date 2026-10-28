import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMenuItemInput, parseShopInput } from "./admin-input";

test("shops: a name is required to create one, and a new shop always starts closed and hidden", () => {
  assert.deepEqual(parseShopInput({ name: "  Test Kitchen ", description: "", location: "Gate" }, true), { ok: true, data: { name: "Test Kitchen", description: null, location: "Gate" } });
  assert.match((parseShopInput({}, true) as { error: string }).error, /Shop name is required/);
  assert.match((parseShopInput({ name: "A", isOpen: true }, true) as { error: string }).error, /Create the shop first/);
  assert.deepEqual(parseShopInput({ isOpen: true }, false), { ok: true, data: { isOpen: true } }, "edits can open it");
  assert.equal(parseShopInput({ isOpen: "yes" }, false).ok, false);
  assert.equal(parseShopInput({ name: "x".repeat(121) }, false).ok, false);
});

test("menu items: name, type and a price of at least ₦1 are required; nothing is filled in", () => {
  assert.deepEqual(parseMenuItemInput({ name: "Amala", role: "BASE", price: 400, section: "Swallow", available: true }, true), { ok: true, data: { name: "Amala", role: "BASE", price: 400, section: "Swallow", available: true } });
  for (const [body, pattern] of [
    [{ role: "MEAL", price: 100 }, /Item name is required/],
    [{ name: "x", price: 100 }, /Choose what this item is/],
    [{ name: "x", role: "DRINK", price: 100 }, /Choose what this item is/],
    [{ name: "x", role: "MEAL" }, /at least ₦1/],
    [{ name: "x", role: "MEAL", price: 0 }, /at least ₦1/],
    [{ name: "x", role: "MEAL", price: 12.5 }, /at least ₦1/],
    [{ name: "x", role: "MEAL", price: 100, maxPerPlate: 2 }, /Only extras/],
    [{ name: "x", role: "EXTRA", price: 100, maxPerPlate: 6 }, /from 1 to 5/],
  ] as const) assert.match((parseMenuItemInput(body, true) as { error: string }).error, pattern, JSON.stringify(body));
  assert.deepEqual(parseMenuItemInput({ name: "Ponmo", role: "EXTRA", price: 150, maxPerPlate: 2 }, true), { ok: true, data: { name: "Ponmo", role: "EXTRA", price: 150, maxPerPlate: 2 } });
});

test("editing an item: only what changed, and its type can't change", () => {
  assert.deepEqual(parseMenuItemInput({ available: false }, false, "MEAL"), { ok: true, data: { available: false } });
  assert.deepEqual(parseMenuItemInput({ price: 350 }, false, "EXTRA"), { ok: true, data: { price: 350 } });
  assert.match((parseMenuItemInput({ role: "MEAL" }, false, "EXTRA") as { error: string }).error, /can’t be changed/);
  assert.deepEqual(parseMenuItemInput({ maxPerPlate: null }, false, "EXTRA"), { ok: true, data: { maxPerPlate: null } }, "back to the default of 5");
});
