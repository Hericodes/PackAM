/**
 * Catalogue permissions against a disposable database: only admins can create or change products
 * (including the customer price), every other role is refused server-side, and runner sourcing
 * reports shop prices without touching the catalogue price or a paid order's amount.
 * Run with `npm run test:db`; see src/test-support/db-harness.ts for the safety rules.
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  createTestVendor,
  dbTestSkip as skip,
  signInAs,
  testDb,
  trustedTestVerifiedPayment,
} from "../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  products: typeof import("../app/api/products/route");
  product: typeof import("../app/api/products/[id]/route");
  signing: typeof import("../app/api/admin/product-images/route");
  productSources: typeof import("../app/api/admin/product-sources/route");
  categories: typeof import("../app/api/admin/categories/route");
  cart: typeof import("../app/api/cart/route");
  runnerOrders: typeof import("../app/api/runner/orders/[id]/route");
  payments: typeof import("./payments/payment-lifecycle");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [products, product, signing, productSources, categories, cart, runnerOrders, payments] = await Promise.all([
    import("../app/api/products/route"),
    import("../app/api/products/[id]/route"),
    import("../app/api/admin/product-images/route"),
    import("../app/api/admin/product-sources/route"),
    import("../app/api/admin/categories/route"),
    import("../app/api/cart/route"),
    import("../app/api/runner/orders/[id]/route"),
    import("./payments/payment-lifecycle"),
  ]);
  app = { db, products, product, signing, productSources, categories, cart, runnerOrders, payments };
});
after(cleanupTestData);

test("only admins can create catalogue products, and never at ₦0", { skip }, async () => {
  const { db, products } = app;
  const admin = await createTestUser("ADMIN");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const student = await createTestUser("STUDENT");
  const { categoryId } = await createTestCatalogue([]);
  const body = (overrides: Record<string, unknown> = {}) => ({ name: `Permission test ${randomUUID().slice(0, 6)}`, categoryId, customerPrice: 1_500, ...overrides });

  for (const user of [null, student, runner]) {
    signInAs(user);
    const attempt = body({ customerPrice: 0 });
    const response = await callRoute(products.POST, { method: "POST", body: attempt });
    assert.equal(response.status, 403, `${user?.role ?? "anonymous"} must be refused`);
    assert.equal(await db.product.count({ where: { name: attempt.name } }), 0, "nothing was created");
  }

  signInAs(admin);
  for (const customerPrice of [0, -500, 99.5, "1500", null]) {
    const response = await callRoute(products.POST, { method: "POST", body: body({ customerPrice }) });
    assert.equal(response.status, 400, `price ${String(customerPrice)} must be rejected`);
  }
  const created = await callRoute(products.POST, { method: "POST", body: body() });
  assert.equal(created.status, 201);
  assert.equal(created.json.customerPrice, 1_500);
  await db.product.delete({ where: { id: created.json.id as string } });
});

test("only admins can change a product's price, status or category", { skip }, async () => {
  const { db, product } = app;
  const admin = await createTestUser("ADMIN");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const student = await createTestUser("STUDENT");
  const { products: [item] } = await createTestCatalogue([{ name: "Locked price", price: 800 }]);
  const otherCategory = await createTestCatalogue([]);

  for (const user of [null, student, runner]) {
    signInAs(user);
    for (const change of [{ customerPrice: 0 }, { customerPrice: 1 }, { status: "INACTIVE" }, { categoryId: otherCategory.categoryId }, { name: "Renamed" }]) {
      const response = await callRoute(product.PATCH, { method: "PATCH", params: { id: item.id }, body: change });
      assert.equal(response.status, 403, `${user?.role ?? "anonymous"} ${JSON.stringify(change)}`);
    }
    assert.equal((await callRoute(product.GET, { params: { id: item.id } })).status, 403, "sourcing data stays private");
  }
  const unchanged = await db.product.findUniqueOrThrow({ where: { id: item.id }, select: { customerPrice: true, status: true, categoryId: true, name: true } });
  assert.equal(unchanged.customerPrice, 800);
  assert.equal(unchanged.status, "ACTIVE");
  assert.equal(await db.auditLog.count({ where: { resourceId: item.id, action: "PRODUCT_UPDATED" } }), 0);

  signInAs(admin);
  for (const customerPrice of [0, -1, 12.5]) {
    assert.equal((await callRoute(product.PATCH, { method: "PATCH", params: { id: item.id }, body: { customerPrice } })).status, 400, String(customerPrice));
  }
  const updated = await callRoute(product.PATCH, { method: "PATCH", params: { id: item.id }, body: { customerPrice: 950 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.customerPrice, 950);
  assert.equal((await callRoute(product.GET, { params: { id: item.id } })).status, 200);
  const audit = await db.auditLog.findFirstOrThrow({ where: { resourceId: item.id, action: "PRODUCT_UPDATED" }, select: { actorId: true } });
  assert.equal(audit.actorId, admin.userId, "price changes are attributed to the admin");
});

test("other catalogue-management routes are admin-only too", { skip }, async () => {
  const { products, signing, productSources, categories } = app;
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const student = await createTestUser("STUDENT");
  const vendor = await createTestVendor();
  const { products: [item] } = await createTestCatalogue([{ name: "Source target", price: 600 }]);
  for (const user of [runner, student]) {
    signInAs(user);
    assert.equal((await callRoute(products.GET)).status, 403, "catalogue export");
    assert.equal((await callRoute(signing.POST, { method: "POST" })).status, 403, "product image upload credentials");
    assert.equal((await callRoute(productSources.POST, { method: "POST", body: { productId: item.id, vendorId: vendor.id, availability: "AVAILABLE", currentPrice: 0 } })).status, 403, "vendor sources");
    assert.equal((await callRoute(categories.POST, { method: "POST", body: { name: "Hacked" } })).status, 403, "categories");
  }
});

test("runner sourcing reports shop prices without changing the catalogue or the paid amount", { skip }, async () => {
  const { db, cart, runnerOrders, payments } = app;
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const vendor = await createTestVendor("Campus mart");
  const { products: [biro, malt] } = await createTestCatalogue([{ name: "Biro", price: 500 }, { name: "Malt", price: 600 }]);

  signInAs(student);
  assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: biro.id, quantity: 1 } })).status, 200);
  assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: malt.id, quantity: 1 } })).status, 200);
  const location = await createTestLocation(student.userId);
  signInAs(student);
  const attempt = await payments.createPaymentAttempt("OPAY", location.id, randomUUID());
  const { orderId } = await payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));
  const items = await db.orderItem.findMany({ where: { orderId: orderId! }, select: { id: true, productId: true } });
  const biroItem = items.find((i) => i.productId === biro.id)!;
  const maltItem = items.find((i) => i.productId === malt.id)!;

  signInAs(runner);
  const act = (body: Record<string, unknown>) => callRoute(runnerOrders.POST, { method: "POST", params: { id: orderId! }, body });
  assert.equal((await act({ action: "accept" })).status, 200);
  for (const actualUnitPrice of [0, -50, 10.5]) {
    const rejected = await act({ action: "source", orderItemId: biroItem.id, vendorId: vendor.id, result: "AVAILABLE", quantity: 1, actualUnitPrice });
    assert.equal(rejected.status, 409, `shop price ${actualUnitPrice} must be rejected`);
  }
  const higher = await act({ action: "source", orderItemId: biroItem.id, vendorId: vendor.id, result: "AVAILABLE", quantity: 1, actualUnitPrice: 700 });
  assert.equal(higher.status, 200);
  assert.equal(higher.json.status, "PRICE_PENDING", "a higher shop price needs the student's decision");
  const lower = await act({ action: "source", orderItemId: maltItem.id, vendorId: vendor.id, result: "AVAILABLE", quantity: 1, actualUnitPrice: 450 });
  assert.equal(lower.status, 200);

  const catalogue = await db.product.findMany({ where: { id: { in: [biro.id, malt.id] } }, select: { id: true, customerPrice: true } });
  assert.deepEqual(Object.fromEntries(catalogue.map((p) => [p.id, p.customerPrice])), { [biro.id]: 500, [malt.id]: 600 }, "catalogue prices unchanged");
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId! }, select: { total: true, items: { select: { productId: true, unitPrice: true } } } });
  assert.equal(order.total, attempt.amount, "the paid amount is unchanged");
  assert.ok(order.items.every((i) => i.unitPrice === (i.productId === biro.id ? 500 : 600)), "order item prices unchanged");
  const source = await db.productSource.findFirstOrThrow({ where: { productId: biro.id, vendorId: vendor.id }, select: { currentPrice: true } });
  assert.equal(source.currentPrice, 700, "the shop price is recorded separately on the vendor source");

  // A new student checking out after the runner's report still pays the catalogue price.
  const nextStudent = await createTestUser("STUDENT");
  signInAs(nextStudent);
  assert.equal((await callRoute(cart.POST, { method: "POST", body: { productId: biro.id, quantity: 1 } })).status, 200);
  const nextLocation = await createTestLocation(nextStudent.userId);
  signInAs(nextStudent);
  const nextAttempt = await payments.createPaymentAttempt("OPAY", nextLocation.id, randomUUID());
  assert.equal(nextAttempt.amount, 500 + (attempt.amount - 1_100));
});
