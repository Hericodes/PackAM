import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CategoryCard } from "./CategoryCard";
import { PrintStudio } from "./PrintStudio";

test("the printing category opens the dedicated printing page without changing other categories", () => {
  const printingLink = renderToStaticMarkup(createElement(CategoryCard, { name: "Printing", slug: "printing", emoji: "🖨️" }));
  const foodLink = renderToStaticMarkup(createElement(CategoryCard, { name: "Food & Drinks", slug: "food-drinks", emoji: "🍔" }));
  assert.match(printingLink, /href="\/printing"/);
  assert.match(foodLink, /href="\/search\?category=food-drinks"/);
});

test("the printing experience renders its upload entry before a document is selected", () => {
  const page = renderToStaticMarkup(createElement(PrintStudio, { locations: [], initialJob: null }));
  assert.match(page, /Your document/);
  assert.match(page, /Choose a PDF/);
  assert.match(page, /Up to 15 MB/);
});
