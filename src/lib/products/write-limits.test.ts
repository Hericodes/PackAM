import assert from "node:assert/strict";
import { test } from "node:test";
import { IMPORT_MAX_ROWS } from "./bulk-import";
import { PRODUCT_WRITE_LIMITS, isVisibilityOnlyChange, productLimitMessage, productWriteLimitKey } from "./write-limits";

test("only the list's Activate / Deactivate request counts as a visibility change", () => {
  assert.equal(isVisibilityOnlyChange({ status: "ACTIVE" }), true);
  assert.equal(isVisibilityOnlyChange({ status: "INACTIVE" }), true);
  assert.equal(isVisibilityOnlyChange({ status: "ACTIVE", customerPrice: 1 }), false, "anything more is an edit");
  assert.equal(isVisibilityOnlyChange({ name: "x", description: "", imageUrl: "", categoryId: "c", status: "ACTIVE" }), false, "the edit form");
  for (const body of [null, undefined, [], "status", {}]) assert.equal(isVisibilityOnlyChange(body), false, String(body));
});

test("visibility and edits have separate budgets, each still limited per admin", () => {
  assert.notEqual(productWriteLimitKey("visibility", "admin-1"), productWriteLimitKey("edit", "admin-1"));
  assert.notEqual(productWriteLimitKey("visibility", "admin-1"), productWriteLimitKey("visibility", "admin-2"));
  assert.equal(productWriteLimitKey("edit", "admin-1"), "product-write:admin-1", "edits keep the existing counter");
  assert.ok(PRODUCT_WRITE_LIMITS.visibility.limit >= IMPORT_MAX_ROWS, "a full CSV import can be activated within an hour");
  assert.ok(PRODUCT_WRITE_LIMITS.edit.limit > 30, "more room than the old shared limit of 30");
  assert.ok(Number.isFinite(PRODUCT_WRITE_LIMITS.visibility.limit) && Number.isFinite(PRODUCT_WRITE_LIMITS.edit.limit), "never unlimited");
});

test("the limit message says nothing changed and when to try again", () => {
  assert.equal(productLimitMessage("visibility", 23 * 60 + 5), "You’ve shown or hidden 600 products this hour, the safety limit. Nothing was changed. Try again in about 24 minutes.");
  assert.match(productLimitMessage("edit", 30), /120 product changes this hour.*Try again in about a minute\./);
});
