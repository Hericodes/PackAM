import assert from "node:assert/strict";
import { test } from "node:test";
import { summariseReorder } from "./reorder";

test("reordering says plainly what was added and that today's prices apply", () => {
  assert.deepEqual(summariseReorder([{ name: "Gala", added: true }, { name: "Malt", added: true }]), {
    added: 2,
    message: "Added all 2 items to your cart at today’s prices.",
  });
  const partial = summariseReorder([{ name: "Gala", added: true }, { name: "Rare book", added: false }]);
  assert.equal(partial.added, 1);
  assert.match(partial.message, /Added 1 of 2 items/);
  assert.match(partial.message, /Not available now: Rare book/);
});

test("nothing available is never reported as success", () => {
  const none = summariseReorder([{ name: "A", added: false }, { name: "B", added: false }]);
  assert.equal(none.added, 0);
  assert.doesNotMatch(none.message, /Added/);
  assert.match(none.message, /request them/);
  assert.equal(summariseReorder([]).added, 0);
  assert.match(summariseReorder(["a", "b", "c", "d", "e"].map((name) => ({ name, added: false }))).message, /and 2 more/);
});
