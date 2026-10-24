/**
 * The admin "add product" workflow through the real products API against a disposable database:
 * retried creates never duplicate, photos are optional and never faked, editing keeps the photo,
 * and only admins can change anything. Run with `npm run test:db` (see src/test-support/db-harness.ts).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestUser,
  dbTestSkip as skip,
  signInAs,
  testDb,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newProductRequestId } from "./product-form";

// No Cloudinary credentials in tests: a check that reached image storage would fail with 503, which
// proves the routes below never ask storage when they don't need to.
process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "packam-test-cloud";
delete process.env.CLOUDINARY_API_SECRET;

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  products: typeof import("../../app/api/products/route");
  product: typeof import("../../app/api/products/[id]/route");
  images: typeof import("../../app/api/admin/product-images/route");
  catalogue: typeof import("./catalogue");
};
let app: App;
const made: string[] = [];

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [products, product, images, catalogue] = await Promise.all([
    import("../../app/api/products/route"),
    import("../../app/api/products/[id]/route"),
    import("../../app/api/admin/product-images/route"),
    import("./catalogue"),
  ]);
  app = { db, products, product, images, catalogue };
});

after(async () => {
  if (!skip && made.length) await app.db.product.deleteMany({ where: { id: { in: made } } });
  await cleanupTestData();
});

const photo = "https://res.cloudinary.com/packam-test-cloud/image/upload/v1712345/packam/products/test-photo.jpg";

test("a retried 'Add product' returns the product it already created instead of a duplicate", { skip }, async () => {
  const { db, products } = app;
  const admin = await createTestUser("ADMIN");
  const { categoryId } = await createTestCatalogue([]);
  const requestId = newProductRequestId();
  const body = { requestId, name: `Retry test ${requestId.slice(0, 6)}`, categoryId, customerPrice: 1_200 };
  signInAs(admin);
  const first = await callRoute(products.POST, { method: "POST", body });
  const again = await callRoute(products.POST, { method: "POST", body });
  const racing = await Promise.all([callRoute(products.POST, { method: "POST", body }), callRoute(products.POST, { method: "POST", body })]);
  made.push(requestId);
  assert.equal(first.status, 201);
  assert.equal(first.json.id, requestId);
  assert.equal(again.status, 200);
  assert.equal(again.json.replayed, true);
  for (const response of racing) assert.equal(response.json.id, requestId);
  assert.equal(await db.product.count({ where: { name: body.name } }), 1, "exactly one product");
  assert.equal((await callRoute(products.POST, { method: "POST", body: { ...body, requestId: "not-a-request-id" } })).status, 400);
});

test("a product can be added without a photo and shows in the marketplace with the fallback", { skip }, async () => {
  const { db, products, catalogue } = app;
  const admin = await createTestUser("ADMIN");
  const { categoryId } = await createTestCatalogue([]);
  signInAs(admin);
  const response = await callRoute(products.POST, { method: "POST", body: { requestId: newProductRequestId(), name: `No photo ${Date.now()}`, categoryId, customerPrice: 700, imageUrl: "" } });
  made.push(response.json.id as string);
  assert.equal(response.status, 201);
  assert.equal(response.json.imageUrl, null, "no photo is stored, and no placeholder URL is invented");
  const visible = await db.product.findFirst({ where: { id: response.json.id as string, ...catalogue.studentCatalogueProductWhere } });
  assert.ok(visible, "students can see it (the storefront draws the category illustration)");
});

test("fake or foreign image URLs are refused and nothing is created", { skip }, async () => {
  const { db, products } = app;
  const admin = await createTestUser("ADMIN");
  const { categoryId } = await createTestCatalogue([]);
  signInAs(admin);
  for (const imageUrl of ["https://example.com/pen.jpg", "https://res.cloudinary.com/someone-else/image/upload/v1/pen.jpg", "javascript:alert(1)"]) {
    const name = `Fake photo ${newProductRequestId().slice(0, 6)}`;
    const response = await callRoute(products.POST, { method: "POST", body: { requestId: newProductRequestId(), name, categoryId, customerPrice: 500, imageUrl } });
    assert.equal(response.status, 400, imageUrl);
    assert.equal(await db.product.count({ where: { name } }), 0);
  }
  // A PackAM-looking URL is checked against image storage before saving; storage is unavailable here.
  const unchecked = await callRoute(products.POST, { method: "POST", body: { requestId: newProductRequestId(), name: "Unchecked photo", categoryId, customerPrice: 500, imageUrl: photo } });
  assert.equal(unchecked.status, 503, "never saved on trust");
  assert.equal(await db.product.count({ where: { name: "Unchecked photo" } }), 0);
});

test("editing other fields keeps the photo, and removing the photo clears only the photo", { skip }, async () => {
  const { db, product } = app;
  const admin = await createTestUser("ADMIN");
  const { products: [item] } = await createTestCatalogue([{ name: "Edit keeps photo", price: 900 }]);
  await db.product.update({ where: { id: item.id }, data: { imageUrl: photo, description: "Blue ink" } });
  signInAs(admin);
  // The form always sends the current photo back; an unchanged photo is not re-checked with storage.
  const renamed = await callRoute(product.PATCH, { method: "PATCH", params: { id: item.id }, body: { name: "Edit keeps photo (renamed)", imageUrl: photo, customerPrice: 950 } });
  assert.equal(renamed.status, 200);
  let saved = await db.product.findUniqueOrThrow({ where: { id: item.id } });
  assert.deepEqual([saved.name, saved.imageUrl, saved.customerPrice, saved.description], ["Edit keeps photo (renamed)", photo, 950, "Blue ink"]);
  const removed = await callRoute(product.PATCH, { method: "PATCH", params: { id: item.id }, body: { imageUrl: "" } });
  assert.equal(removed.status, 200);
  saved = await db.product.findUniqueOrThrow({ where: { id: item.id } });
  assert.deepEqual([saved.imageUrl, saved.name, saved.customerPrice], [null, "Edit keeps photo (renamed)", 950]);
});

test("students, runners and signed-out visitors can't create, edit, delete or upload", { skip }, async () => {
  const { db, products, product, images } = app;
  const { products: [item], categoryId } = await createTestCatalogue([{ name: "Protected product", price: 800 }]);
  for (const user of [null, await createTestUser("STUDENT"), await createTestUser("RUNNER", { isVerified: true, isAvailable: true })]) {
    signInAs(user);
    const who = user?.role ?? "signed out";
    assert.equal((await callRoute(products.POST, { method: "POST", body: { requestId: newProductRequestId(), name: "Sneaky", categoryId, customerPrice: 1 } })).status, 403, `${who}: create`);
    assert.equal((await callRoute(product.PATCH, { method: "PATCH", params: { id: item.id }, body: { customerPrice: 1, imageUrl: "" } })).status, 403, `${who}: edit`);
    assert.equal((await callRoute(product.DELETE, { method: "DELETE", params: { id: item.id } })).status, 403, `${who}: delete`);
    assert.equal((await callRoute(images.POST, { method: "POST" })).status, 403, `${who}: upload credentials`);
  }
  const unchanged = await db.product.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(unchanged.customerPrice, 800);
  assert.equal(await db.product.count({ where: { name: "Sneaky" } }), 0);
});
