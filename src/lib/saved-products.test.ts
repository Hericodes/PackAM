import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSavedProductIds, SAVED_PRODUCTS_LIMIT, toggleSavedProductId } from "./saved-products";

test("saved product ids survive only as a clean, de-duplicated list", () => {
  assert.deepEqual(parseSavedProductIds(null), []);
  assert.deepEqual(parseSavedProductIds("not json"), []);
  assert.deepEqual(parseSavedProductIds('{"a":1}'), []);
  assert.deepEqual(parseSavedProductIds('["abc","abc","x-1_2",42,"<script>","' + "z".repeat(80) + '"]'), ["abc", "x-1_2"]);
});

test("the saved list is capped so local storage cannot grow without bound", () => {
  const many = JSON.stringify(Array.from({ length: SAVED_PRODUCTS_LIMIT + 20 }, (_, i) => `p${i}`));
  assert.equal(parseSavedProductIds(many).length, SAVED_PRODUCTS_LIMIT);
  const full = Array.from({ length: SAVED_PRODUCTS_LIMIT }, (_, i) => `p${i}`);
  const added = toggleSavedProductId(full, "new");
  assert.equal(added.ids.length, SAVED_PRODUCTS_LIMIT);
  assert.equal(added.ids[0], "new");
});

test("toggling saves newest first and unsaves cleanly", () => {
  const saved = toggleSavedProductId(["a"], "b");
  assert.deepEqual(saved, { ids: ["b", "a"], saved: true });
  assert.deepEqual(toggleSavedProductId(saved.ids, "a"), { ids: ["b"], saved: false });
  assert.deepEqual(toggleSavedProductId(["a"], "bad id!"), { ids: ["a"], saved: false });
});
