/**
 * Products created before their price is confirmed, against a disposable database: they can be
 * edited (name, photo, category) while inactive, can't be activated or bought until a real price is
 * set, and the database itself refuses an ACTIVE ₦0 product.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import { callRoute, cleanupTestData, createTestCatalogue, createTestUser, dbTestSkip as skip, signInAs, testDb } from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  product: typeof import("../../app/api/products/[id]/route");
  cart: typeof import("../../app/api/cart/route");
  search: typeof import("../../app/api/search/route");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [product, cart, search] = await Promise.all([import("../../app/api/products/[id]/route"), import("../../app/api/cart/route"), import("../../app/api/search/route")]);
  app = { db, product, cart, search };
});
after(cleanupTestData);

async function unpricedProduct(name: string) {
  const { products, categoryId } = await createTestCatalogue([{ name, price: 100 }]);
  // How scripts/add-academic-products.ts stores them: inactive, price not set, no image.
  await app.db.product.update({ where: { id: products[0].id }, data: { status: "INACTIVE", customerPrice: 0, imageUrl: null } });
  return { id: products[0].id, name: products[0].name, categoryId };
}

test("an unpriced product can be edited while inactive but not activated until it has a real price", { skip }, async () => {
  const { db } = app;
  const admin = await createTestUser("ADMIN");
  const product = await unpricedProduct("Unpriced highlighter");
  signInAs(admin);

  // What the edit form sends when the price field is left empty: no customerPrice at all.
  const edited = await callRoute(app.product.PATCH, { method: "PATCH", params: { id: product.id }, body: { name: `${product.name} (yellow)`, description: "Chisel tip", categoryId: product.categoryId, status: "INACTIVE" } });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).customerPrice, 0, "no price was invented");

  signInAs(admin);
  const activate = await callRoute(app.product.PATCH, { method: "PATCH", params: { id: product.id }, body: { status: "ACTIVE" } });
  assert.equal(activate.status, 400);
  assert.match(String(activate.json.error), /at least ₦1 before activating/);
  signInAs(admin);
  assert.equal((await callRoute(app.product.PATCH, { method: "PATCH", params: { id: product.id }, body: { customerPrice: 0, status: "ACTIVE" } })).status, 400);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status, "INACTIVE");

  signInAs(admin);
  const priced = await callRoute(app.product.PATCH, { method: "PATCH", params: { id: product.id }, body: { customerPrice: 450, status: "ACTIVE" } });
  assert.equal(priced.status, 200, JSON.stringify(priced.json));
  const final = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.deepEqual({ status: final.status, price: final.customerPrice }, { status: "ACTIVE", price: 450 });
});

test("students can't see or buy an unpriced product, and the database refuses an ACTIVE ₦0 product", { skip }, async () => {
  const { db } = app;
  const student = await createTestUser("STUDENT");
  const product = await unpricedProduct("Unpriced pencil");

  signInAs(student);
  const added = await callRoute(app.cart.POST, { method: "POST", body: { productId: product.id, quantity: 1 } });
  assert.notEqual(added.status, 200, "can't be added to a cart");
  signInAs(null);
  const found = await callRoute(app.search.GET, { path: `/api/search?q=${encodeURIComponent(product.name)}` });
  assert.doesNotMatch(JSON.stringify(found.json), new RegExp(product.id));

  await assert.rejects(db.product.update({ where: { id: product.id }, data: { status: "ACTIVE" } }), /Product_active_requires_price_check|check constraint/i);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status, "INACTIVE");
});
