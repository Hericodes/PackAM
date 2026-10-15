/**
 * Student catalogue visibility against a disposable database: printing is a dedicated workflow,
 * so products filed under the printing category are never listed, saved-looked-up, added to a
 * cart or checked out. Run with `npm run test:db` (see src/test-support/db-harness.ts).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  dbTestSkip as skip,
  signInAs,
  testDb,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

after(cleanupTestData);

test("printing-category products stay out of the student catalogue, cart and checkout", { skip }, async () => {
  const db = await testDb();
  const search = await import("../../app/api/search/route");
  const catalogue = await import("../../app/api/catalogue/route");
  const cart = await import("../../app/api/cart/route");
  const payments = await import("../payments/payment-lifecycle");

  const student = await createTestUser("STUDENT");
  const { products: [normal] } = await createTestCatalogue([{ name: "Visible notebook", price: 600 }]);
  const printingCategory = await db.category.upsert({ where: { slug: "printing" }, create: { name: "Printing", slug: "printing" }, update: {}, select: { id: true } });
  const tag = randomUUID().slice(0, 8);
  const printingProduct = await db.product.create({
    data: { categoryId: printingCategory.id, name: `Legacy colour printing ${tag}`, slug: `legacy-printing-${tag}`, customerPrice: 300 },
    select: { id: true, name: true },
  });

  try {
    signInAs(null);
    const byName = await callRoute(search.GET, { path: `/api/search?q=${encodeURIComponent(printingProduct.name)}` });
    assert.doesNotMatch(JSON.stringify(byName.json), new RegExp(printingProduct.id), "not found by search");
    const byCategory = await callRoute(search.GET, { path: "/api/search?category=printing" });
    assert.deepEqual(byCategory.json.products, [], "printing category is not browsable as products");
    const lookup = await callRoute(catalogue.GET, { path: `/api/catalogue?ids=${printingProduct.id},${normal.id}` });
    assert.deepEqual((lookup.json.products as Array<{ id: string }>).map((p) => p.id), [normal.id], "saved-items lookup only returns catalogue products");
    const visible = await callRoute(search.GET, { path: `/api/search?q=${encodeURIComponent(normal.name)}` });
    assert.match(JSON.stringify(visible.json), new RegExp(normal.id), "ordinary products are unaffected");

    signInAs(student);
    assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: printingProduct.id, quantity: 1 } })).status, 404, "cannot be added to a cart");
    assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: normal.id, quantity: 1 } })).status, 200);

    // A cart created before this rule could still hold one; checkout must refuse it.
    const studentCart = await db.cart.findUniqueOrThrow({ where: { userId: student.userId }, select: { id: true } });
    await db.cartItem.create({ data: { cartId: studentCart.id, productId: printingProduct.id, quantity: 1 } });
    const location = await createTestLocation(student.userId);
    signInAs(student);
    await assert.rejects(payments.createPaymentAttempt("OPAY", location.id, randomUUID()), /no longer available/i);
    assert.equal(await db.payment.count({ where: { userId: student.userId } }), 0, "no payment attempt was created");
  } finally {
    await db.cartItem.deleteMany({ where: { productId: printingProduct.id } });
    await db.product.delete({ where: { id: printingProduct.id } });
  }
});

test("the saved-items lookup ignores malformed ids and caps the request", { skip }, async () => {
  await testDb();
  const catalogue = await import("../../app/api/catalogue/route");
  signInAs(null);
  const { products: [item] } = await createTestCatalogue([{ name: "Lookup target", price: 450 }]);
  const response = await callRoute(catalogue.GET, { path: `/api/catalogue?ids=${item.id},<script>,${"x".repeat(200)}` });
  assert.equal(response.status, 200);
  assert.deepEqual((response.json.products as Array<{ id: string; customerPrice: number }>).map((p) => [p.id, p.customerPrice]), [[item.id, 450]]);
  assert.doesNotMatch(JSON.stringify(response.json), /sources|vendor|currentPrice/, "no sourcing data is exposed");
  const empty = await callRoute(catalogue.GET, { path: "/api/catalogue" });
  assert.deepEqual(empty.json.products, []);
});
