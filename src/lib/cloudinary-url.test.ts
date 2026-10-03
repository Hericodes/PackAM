import test from "node:test";
import assert from "node:assert/strict";
import { isPackamProductImageUrl } from "./cloudinary-url";

test("product images must be HTTPS image uploads from the configured PackAM cloud", () => {
  assert.equal(isPackamProductImageUrl("https://res.cloudinary.com/packam/image/upload/v1/item.jpg", "packam"), true);
  assert.equal(isPackamProductImageUrl("https://evil.example/item.jpg", "packam"), false);
  assert.equal(isPackamProductImageUrl("https://res.cloudinary.com/other/image/upload/item.jpg", "packam"), false);
  assert.equal(isPackamProductImageUrl("data:image/png;base64,a", "packam"), false);
});
