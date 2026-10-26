/**
 * Activating products through the real PATCH route against a disposable database: several in a row,
 * repeated clicks, incomplete products, the separate visibility budget and its message, and the
 * storefront. Run with `npm run test:db` (see src/test-support/db-harness.ts).
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
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { PRODUCT_WRITE_LIMITS, PRODUCT_WRITE_WINDOW_MS, productWriteLimitKey } from "./write-limits";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  product: typeof import("../../app/api/products/[id]/route");
  catalogue: typeof import("./catalogue");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [product, catalogue] = await Promise.all([import("../../app/api/products/[id]/route"), import("./catalogue")]);
  app = { db, product, catalogue };
});
after(cleanupTestData);

const activate = (id: string) => callRoute(app.product.PATCH, { method: "PATCH", params: { id }, body: { status: "ACTIVE" } });

test("several hidden products, no photo and no stock check, activate one after another and reach the storefront", { skip }, async () => {
  const { db, catalogue } = app;
  signInAs(await createTestUser("ADMIN"));
  const { products } = await createTestCatalogue(Array.from({ length: 35 }, (_, i) => ({ name: `Activate ${i}`, price: 500 + i })));
  await db.product.updateMany({ where: { id: { in: products.map((p) => p.id) } }, data: { status: "INACTIVE", imageUrl: null } });
  for (const item of products) assert.equal((await activate(item.id)).status, 200, item.name);
  const visible = await db.product.count({ where: { id: { in: products.map((p) => p.id) }, ...catalogue.studentCatalogueProductWhere } });
  assert.equal(visible, 35, "more than the old limit of 30, all saved and visible to students");
});

test("rapid repeated clicks are harmless: the product ends up active once", { skip }, async () => {
  const { db } = app;
  signInAs(await createTestUser("ADMIN"));
  const { products: [item] } = await createTestCatalogue([{ name: "Double click", price: 300 }]);
  await db.product.update({ where: { id: item.id }, data: { status: "INACTIVE" } });
  const responses = await Promise.all([activate(item.id), activate(item.id), activate(item.id)]);
  assert.ok(responses.some((response) => response.status === 200));
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: item.id } })).status, "ACTIVE");
});

test("a product without a price can't be activated; no photo, stock or vendor is required", { skip }, async () => {
  const { db } = app;
  signInAs(await createTestUser("ADMIN"));
  const { products: [unpriced, bare] } = await createTestCatalogue([{ name: "No price yet", price: 1 }, { name: "Bare product", price: 250 }]);
  await db.product.update({ where: { id: unpriced.id }, data: { status: "INACTIVE", customerPrice: 0 } });
  await db.product.update({ where: { id: bare.id }, data: { status: "INACTIVE", imageUrl: null } });
  await db.productSource.deleteMany({ where: { productId: bare.id } });
  const refused = await activate(unpriced.id);
  assert.equal(refused.status, 400);
  assert.match(String(refused.json.error), /Set a customer price of at least ₦1/);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: unpriced.id } })).status, "INACTIVE");
  assert.equal((await activate(bare.id)).status, 200, "no photo, no vendor, stock not checked: still allowed");
});

test("at the visibility limit the admin is told when to retry, nothing changes, and edits still work", { skip }, async () => {
  const { db, product } = app;
  const admin = await createTestUser("ADMIN");
  signInAs(admin);
  const { products: [item] } = await createTestCatalogue([{ name: "Limit reached", price: 400 }]);
  await db.product.update({ where: { id: item.id }, data: { status: "INACTIVE" } });
  // Fill this admin's visibility budget for the current window, as consumeRateLimit stores it.
  const key = createHash("sha256").update(productWriteLimitKey("visibility", admin.userId)).digest("hex");
  const windowStart = new Date(Math.floor(Date.now() / PRODUCT_WRITE_WINDOW_MS) * PRODUCT_WRITE_WINDOW_MS);
  await db.rateLimitBucket.upsert({ where: { key_windowStart: { key, windowStart } }, create: { key, windowStart, expiresAt: new Date(windowStart.getTime() + 2 * PRODUCT_WRITE_WINDOW_MS), count: PRODUCT_WRITE_LIMITS.visibility.limit }, update: { count: PRODUCT_WRITE_LIMITS.visibility.limit } });

  const limited = await activate(item.id);
  assert.equal(limited.status, 429);
  assert.match(String(limited.json.error), /Nothing was changed\. Try again in about \d+ minutes?\./);
  assert.ok(Number(limited.json.retryAfterSeconds) > 0);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: item.id } })).status, "INACTIVE");

  const edit = await callRoute(product.PATCH, { method: "PATCH", params: { id: item.id }, body: { name: "Limit reached (renamed)", status: "INACTIVE" } });
  assert.equal(edit.status, 200, "the edit budget is separate");
  await db.rateLimitBucket.deleteMany({ where: { key } });
});
