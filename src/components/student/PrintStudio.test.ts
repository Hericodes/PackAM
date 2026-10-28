import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintStudio } from "./PrintStudio";
import { isDedicatedWorkflowCategory, studentCatalogueCategoryWhere, studentCatalogueProductWhere } from "../../lib/products/catalogue";

test("printing is a dedicated workflow, never a catalogue category or cart item", () => {
  assert.equal(isDedicatedWorkflowCategory("printing"), true);
  assert.equal(isDedicatedWorkflowCategory("food-drinks"), false);
  assert.equal(isDedicatedWorkflowCategory("food"), true, "food shop menus are ordered through /food only");
  assert.deepEqual(studentCatalogueCategoryWhere.slug.notIn, ["printing", "food"], "catalogue filters exclude printing and food menus");
  assert.deepEqual(studentCatalogueProductWhere.category.slug.notIn, ["printing", "food"], "catalogue products exclude printing and food menus");
  assert.equal(studentCatalogueProductWhere.shopId, null, "no food shop's menu item is ever an Order Stuff product");
  assert.equal(studentCatalogueProductWhere.status, "ACTIVE");
});

test("the printing experience renders its upload entry before a document is selected", () => {
  const page = renderToStaticMarkup(createElement(PrintStudio, { locations: [], initialJob: null }));
  assert.match(page, /Your document/);
  assert.match(page, /Upload Document/);
  assert.match(page, /Up to 15 MB/);
});
