import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import { isProductRequestId, newProductRequestId, nextDraftAfterCreate, parseNairaInput, productDraftPayload, validateProductDraft, type ProductDraft } from "./product-form";
import { ProductForm } from "../../components/products/ProductForm";
import { ProductImageUpload } from "../../components/products/ProductImageUpload";

const draft = (change: Partial<ProductDraft> = {}): ProductDraft => ({ name: "A4 Project File", categoryId: "cat-stationery", price: "1500", description: "", status: "ACTIVE", imageUrl: "", subcategoryId: "", labelIds: [], stock: "", ...change });
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
// Same remote host as next.config.ts, which isn't loaded outside Next.
const images = { ...imageConfigDefault, remotePatterns: [{ protocol: "https" as const, hostname: "res.cloudinary.com" }] };
const render = (node: ReactNode) => renderToStaticMarkup(createElement(ImageConfigContext.Provider, { value: images as never }, createElement(AppRouterContext.Provider, { value: router as never }, node)));
const photo = "https://res.cloudinary.com/packam-cloud/image/upload/v1712345/packam/products/file.jpg";

test("naira input: whole naira, with or without ₦ and commas", () => {
  assert.equal(parseNairaInput("1500"), 1500);
  assert.equal(parseNairaInput("₦1,500"), 1500);
  assert.equal(parseNairaInput("  "), null);
  for (const value of ["15.50", "-200", "1e3", "abc"]) assert.equal(parseNairaInput(value), "invalid", value);
});

test("new products need a name, a category and a real price; photo and description are optional", () => {
  assert.deepEqual(validateProductDraft(draft(), false), {});
  const empty = validateProductDraft(draft({ name: " ", categoryId: "", price: "" }), false);
  assert.deepEqual(Object.keys(empty), ["name", "categoryId", "price"]);
  assert.match(validateProductDraft(draft({ price: "0" }), false).price!, /at least ₦1/);
  assert.match(validateProductDraft(draft({ price: "12.5" }), false).price!, /whole naira/);
  assert.match(validateProductDraft(draft({ name: "x".repeat(121) }), false).name!, /under 120/);
  assert.match(validateProductDraft(draft({ description: "x".repeat(2001) }), false).description!, /under 2000/);
});

test("stock: blank is not tracked, otherwise a whole number of 0 or more", () => {
  assert.deepEqual(validateProductDraft(draft({ stock: "" }), false), {});
  assert.deepEqual(validateProductDraft(draft({ stock: "0" }), false), {});
  assert.match(validateProductDraft(draft({ stock: "-3" }), false).stock!, /whole number of 0 or more/);
  assert.match(validateProductDraft(draft({ stock: "2.5" }), false).stock!, /whole number of 0 or more/);
});

test("an existing product may stay unpriced only while hidden, matching the API and database rule", () => {
  assert.deepEqual(validateProductDraft(draft({ price: "", status: "INACTIVE" }), true), {});
  assert.match(validateProductDraft(draft({ price: "", status: "ACTIVE" }), true).price!, /before making this product visible/);
});

test("the payload sends the typed price as a number and never invents one", () => {
  assert.deepEqual(productDraftPayload(draft({ price: "₦2,000", name: "  Pen  " })), { name: "Pen", description: "", imageUrl: "", categoryId: "cat-stationery", customerPrice: 2000, status: "ACTIVE", subcategoryId: null, labelIds: [], stockQuantity: null });
  assert.equal("customerPrice" in productDraftPayload(draft({ price: "" })), false);
  assert.deepEqual(productDraftPayload(draft({ subcategoryId: "sub-files", labelIds: ["l1"], stock: "12" })).stockQuantity, 12);
  const withOptions = productDraftPayload(draft({ hasVariants: true, stock: "5" }));
  assert.equal("customerPrice" in withOptions || "stockQuantity" in withOptions, false, "price and stock live on each variant");
});

test("add another product keeps the category and visibility and clears the rest", () => {
  const next = nextDraftAfterCreate(draft({ description: "Blue", imageUrl: photo, status: "INACTIVE", subcategoryId: "sub-files", labelIds: ["l1"], stock: "9" }));
  assert.deepEqual(next, { name: "", categoryId: "cat-stationery", subcategoryId: "sub-files", price: "", description: "", status: "INACTIVE", imageUrl: "", labelIds: [], stock: "" });
});

test("request ids are unguessable, well-formed and different each time", () => {
  const ids = new Set(Array.from({ length: 50 }, newProductRequestId));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.ok(isProductRequestId(id), id);
  for (const bad of ["", "seed-product-pen", "A".repeat(32), "1".repeat(31), 42, null]) assert.equal(isProductRequestId(bad), false, String(bad));
});

test("the add form shows the essentials first and tucks description and visibility away", () => {
  const html = render(createElement(ProductForm, { categories: [{ id: "cat-stationery", name: "Stationery" }] }));
  const order = ["Product name", "Category", "Selling price", "Product photo", "More options"].map((label) => html.indexOf(label));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `essentials in order: ${order}`);
  assert.match(html, /<details id="more-options"[^>]*>/);
  assert.doesNotMatch(html, /<details id="more-options"[^>]*open/, "more options start collapsed for a new product");
  assert.match(html, /₦/);
  assert.match(html, />Add product</);
  assert.match(html, /JPG, PNG or WebP · up to 5 MB/);
});

test("editing keeps the product's photo, price and fields", () => {
  const html = render(createElement(ProductForm, {
    categories: [{ id: "cat-stationery", name: "Stationery" }],
    initialData: { id: "p1", name: "A4 Project File", description: "Blue, clear front", imageUrl: photo, categoryId: "cat-stationery", customerPrice: 1500, status: "ACTIVE" },
  }));
  assert.match(html, /value="A4 Project File"/);
  assert.match(html, /value="1500"/);
  assert.match(html, /Blue, clear front/);
  assert.match(html, /Photo ready/);
  assert.match(html, />Replace image</);
  assert.match(html, />Remove image</);
  assert.match(html, />Save changes</);
});

test("the uploader starts idle with drag-and-drop, formats and limits, and no fake image", () => {
  const html = renderToStaticMarkup(createElement(ProductImageUpload, { value: "", onChange: () => {} }));
  assert.match(html, /Drag a photo here/);
  assert.match(html, />Choose image</);
  assert.match(html, /No photo yet/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(html, /<img/, "no placeholder photo");
  assert.doesNotMatch(html, /Remove image/);
});
