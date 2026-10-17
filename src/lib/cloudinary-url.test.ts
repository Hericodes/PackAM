import test from "node:test";
import assert from "node:assert/strict";
import { isPackamProductImageUrl, productImageDeliveryUrl } from "./cloudinary-url";

test("product images must be HTTPS image uploads from the configured PackAM cloud", () => {
  assert.equal(isPackamProductImageUrl("https://res.cloudinary.com/packam/image/upload/v1/item.jpg", "packam"), true);
  assert.equal(isPackamProductImageUrl("https://evil.example/item.jpg", "packam"), false);
  assert.equal(isPackamProductImageUrl("https://res.cloudinary.com/other/image/upload/item.jpg", "packam"), false);
  assert.equal(isPackamProductImageUrl("data:image/png;base64,a", "packam"), false);
});

test("product images are delivered as a size-limited Cloudinary rendition without changing stored URLs", () => {
  assert.equal(
    productImageDeliveryUrl("https://res.cloudinary.com/packam/image/upload/v1792244922/packam/products/water.png"),
    "https://res.cloudinary.com/packam/image/upload/c_limit,w_1600,f_auto,q_auto/v1792244922/packam/products/water.png",
  );
  assert.equal(
    productImageDeliveryUrl("https://res.cloudinary.com/packam/image/upload/packam/products/no-version.jpg"),
    "https://res.cloudinary.com/packam/image/upload/c_limit,w_1600,f_auto,q_auto/packam/products/no-version.jpg",
  );
  // Already transformed, or not a Cloudinary upload: untouched.
  const transformed = "https://res.cloudinary.com/packam/image/upload/c_fill,w_400/v1/item.jpg";
  assert.equal(productImageDeliveryUrl(transformed), transformed);
  assert.equal(productImageDeliveryUrl("https://example.com/item.jpg"), "https://example.com/item.jpg");
  assert.equal(productImageDeliveryUrl("not a url"), "not a url");
});
