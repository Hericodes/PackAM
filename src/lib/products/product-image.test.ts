import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PRODUCT_IMAGE_BYTES, parseProductImageUrl, productImageFileProblem, verifiedUploadUrl } from "./product-image";
import { checkStoredProductImage } from "./product-image-check";

const CLOUD = "packam-cloud";
const url = (path: string) => `https://res.cloudinary.com/${CLOUD}/image/upload/${path}`;

test("image files: JPG, PNG and WebP up to 5 MB are accepted before uploading", () => {
  for (const [name, type] of [["shelf.jpg", "image/jpeg"], ["shelf.JPEG", "image/jpeg"], ["shelf.png", "image/png"], ["shelf.webp", "image/webp"]]) {
    assert.equal(productImageFileProblem({ name, type, size: 200_000 }), null, name);
  }
  assert.equal(productImageFileProblem({ name: "phone-photo.jpg", type: "", size: 1_000 }), null, "a phone that sends no type: the extension decides");
  assert.equal(productImageFileProblem({ name: "exact.png", type: "image/png", size: MAX_PRODUCT_IMAGE_BYTES }), null, "exactly 5 MB is fine");
});

test("image files: wrong types, empty and oversized files are refused with a clear reason", () => {
  assert.match(productImageFileProblem({ name: "anim.gif", type: "image/gif", size: 1_000 })!, /isn’t a JPG, PNG or WebP/);
  assert.match(productImageFileProblem({ name: "notes.pdf", type: "application/pdf", size: 1_000 })!, /isn’t a JPG, PNG or WebP/);
  assert.match(productImageFileProblem({ name: "evil.jpg.exe", type: "", size: 1_000 })!, /isn’t a JPG, PNG or WebP/);
  assert.match(productImageFileProblem({ name: "big.jpg", type: "image/jpeg", size: 6_400_000 })!, /6\.4 MB.*up to 5 MB/);
  assert.match(productImageFileProblem({ name: "empty.png", type: "image/png", size: 0 })!, /empty/);
});

const upload = { resource_type: "image", type: "upload", public_id: "packam/products/abc123", format: "jpg", bytes: 480_000, secure_url: url("v1712345/packam/products/abc123.jpg") };

test("upload responses: only a confirmed image in the product folder of this cloud is used", () => {
  assert.deepEqual(verifiedUploadUrl(upload, CLOUD), { ok: true, url: upload.secure_url });
  const bad: Array<[string, Record<string, unknown>]> = [
    ["another folder", { public_id: "elsewhere/abc123", secure_url: url("v1/elsewhere/abc123.jpg") }],
    ["a disallowed format", { format: "gif" }],
    ["a raw file", { resource_type: "raw" }],
    ["too large", { bytes: MAX_PRODUCT_IMAGE_BYTES + 1 }],
    ["another cloud", { secure_url: "https://res.cloudinary.com/someone-else/image/upload/v1/packam/products/abc123.jpg" }],
    ["a URL that doesn't match the id", { secure_url: url("v1/packam/products/other.jpg") }],
  ];
  for (const [why, change] of bad) assert.equal(verifiedUploadUrl({ ...upload, ...change }, CLOUD).ok, false, why);
  assert.equal(verifiedUploadUrl(null, CLOUD).ok, false);
  assert.equal(verifiedUploadUrl({ error: { message: "Invalid signature" } }, CLOUD).ok, false);
});

test("stored URLs: the public id is read through versions and transformations", () => {
  assert.deepEqual(parseProductImageUrl(url("v1712345/packam/products/abc123.jpg"), CLOUD), { publicId: "packam/products/abc123", format: "jpg" });
  assert.deepEqual(parseProductImageUrl(url("c_limit,w_1600,f_auto,q_auto/v1712345/packam/products/abc123.png"), CLOUD), { publicId: "packam/products/abc123", format: "png" });
  assert.deepEqual(parseProductImageUrl(url("old-photo.webp"), CLOUD), { publicId: "old-photo", format: "webp" }, "older photos outside the folder still parse");
  for (const value of [
    "http://res.cloudinary.com/packam-cloud/image/upload/v1/a.jpg",
    "https://res.cloudinary.com/someone-else/image/upload/v1/a.jpg",
    "https://res.cloudinary.com/packam-cloud/video/upload/v1/a.mp4",
    "https://example.com/packam-cloud/image/upload/v1/a.jpg",
    url("v1/a.jpg?x=1"),
    url("v1/noextension"),
    "not a url",
  ]) assert.equal(parseProductImageUrl(value, CLOUD), null, value);
  assert.equal(parseProductImageUrl(url("v1/a.jpg"), undefined), null, "no cloud configured");
});

test("saving: an image is attached only after image storage confirms it exists", async () => {
  const looked: string[] = [];
  const deps = (answer: { format: string; bytes: number } | null | Error) => ({
    cloudName: CLOUD,
    maxBytes: MAX_PRODUCT_IMAGE_BYTES,
    lookup: async (publicId: string) => { looked.push(publicId); if (answer instanceof Error) throw answer; return answer; },
  });
  assert.deepEqual(await checkStoredProductImage(upload.secure_url, deps({ format: "jpg", bytes: 480_000 })), { ok: true });
  assert.deepEqual(looked, ["packam/products/abc123"]);

  const missing = await checkStoredProductImage(upload.secure_url, deps(null));
  assert.equal(missing.ok, false);
  assert.ok(!missing.ok && missing.status === 400 && /isn’t in PackAM’s image storage/.test(missing.error), "an unfinished or fake upload is refused");

  const wrongType = await checkStoredProductImage(upload.secure_url, deps({ format: "gif", bytes: 10 }));
  assert.ok(!wrongType.ok && wrongType.status === 400);

  const outage = await checkStoredProductImage(upload.secure_url, deps(new Error("ECONNRESET")));
  assert.ok(!outage.ok && outage.status === 503 && /other details are still here/.test(outage.error), "a storage outage is a retryable error, not 'missing'");

  const unconfigured = await checkStoredProductImage(upload.secure_url, deps(new Error("IMAGE_STORAGE_NOT_CONFIGURED")));
  assert.ok(!unconfigured.ok && unconfigured.status === 503);

  looked.length = 0;
  const fake = await checkStoredProductImage("https://example.com/photo.jpg", deps({ format: "jpg", bytes: 1 }));
  assert.ok(!fake.ok && fake.status === 400);
  assert.deepEqual(looked, [], "a URL from anywhere else is refused without asking storage");
});
