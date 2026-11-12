import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeFood } from "./food-intent";

test("requests for cooked food are spotted, however students write them", () => {
  for (const text of [
    "Jollof rice", "jollof rice and chicken", "Amala and ewedu", "pounded yam with egusi", "EBA", "Fried rice + turkey", "rice and stew",
    "Ofada rice", "beans and dodo", "Moi moi", "moimoi", "Spaghetti", "Shawarma", "suya", "pepper soup", "Semo and ogbono soup",
    "A plate of food", "lunch", "Food abeg", "Efo riro", "ewa agoyin", "yam porridge", "chicken", "Indomie and egg",
  ]) assert.equal(looksLikeFood(text), true, text);
});

test("shop things that only mention a food word are not food", () => {
  for (const text of [
    "Scientific calculator", "Rice cooker", "Food flask", "Plates", "Lunch box", "bag of rice", "Soup bowl", "Hot plate", "Notebook",
    "Casio FX-991ES Plus", "Phone charger", "Ricecake", "Okrasheet", "dog food", "Laundry starch", "Indomie", "Bread", "Coke",
  ]) assert.equal(looksLikeFood(text), false, text);
});

test("any field can say it: the name, the variant or the note", () => {
  assert.equal(looksLikeFood("Something nice", "", "jollof with plenty meat"), true);
  assert.equal(looksLikeFood("Calculator", null, undefined), false);
  assert.equal(looksLikeFood("", "  "), false);
  assert.equal(looksLikeFood("Rice cooker and jollof"), true, "a kitchen phrase doesn't hide a real meal");
});
