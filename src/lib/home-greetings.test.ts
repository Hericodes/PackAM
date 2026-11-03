import assert from "node:assert/strict";
import test from "node:test";
import { HOME_GREETINGS, parseGreetingIndex, pickHomeGreeting } from "./home-greetings";

test("five Pidgin greetings, the signature one first, each with a line underneath", () => {
  assert.equal(HOME_GREETINGS.length, 5);
  assert.equal(HOME_GREETINGS[0].title, "Wetin dey sup?");
  assert.equal(new Set(HOME_GREETINGS.map((g) => g.title)).size, 5);
  for (const greeting of HOME_GREETINGS) assert.ok(greeting.title.length <= 32 && greeting.subtitle.length <= 70, greeting.title);
});

test("every greeting can be picked, and odd random values never break the page", () => {
  assert.deepEqual(HOME_GREETINGS.map((_, i) => pickHomeGreeting(() => (i + 0.5) / HOME_GREETINGS.length).greeting), [...HOME_GREETINGS]);
  assert.equal(pickHomeGreeting(() => 0).index, 0);
  assert.equal(pickHomeGreeting(() => 0.9999999).index, 4);
  assert.equal(pickHomeGreeting(() => 1).index, 4);
  assert.equal(pickHomeGreeting(() => -1).index, 0);
});

test("the next visit never shows the greeting from last time", () => {
  for (let last = 0; last < HOME_GREETINGS.length; last += 1) {
    const seen = new Set<number>();
    for (let step = 0; step < 40; step += 1) {
      const { index, greeting } = pickHomeGreeting(() => step / 40, last);
      assert.notEqual(index, last);
      assert.equal(greeting, HOME_GREETINGS[index]);
      seen.add(index);
    }
    assert.equal(seen.size, HOME_GREETINGS.length - 1, "every other greeting still comes up");
  }
});

test("only a valid stored index counts", () => {
  assert.equal(parseGreetingIndex("3"), 3);
  for (const bad of [undefined, "", "5", "9", "-1", "1.5", "abc", "12"]) assert.equal(parseGreetingIndex(bad), null, String(bad));
});
