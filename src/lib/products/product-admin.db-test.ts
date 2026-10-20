/**
 * Admin product management against a disposable database: active-first ordering across pages and
 * filters, deactivation without deletion, and protected deletion through the real DELETE route.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
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
  trustedTestVerifiedPayment,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  product: typeof import("../../app/api/products/[id]/route");
  cart: typeof import("../../app/api/cart/route");
  search: typeof import("../../app/api/search/route");
  payments: typeof import("../payments/payment-lifecycle");
  catalogue: typeof import("./admin-catalogue");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [product, cart, search, payments, catalogue] = await Promise.all([
    import("../../app/api/products/[id]/route"),
    import("../../app/api/cart/route"),
    import("../../app/api/search/route"),
    import("../payments/payment-lifecycle"),
    import("./admin-catalogue"),
  ]);
  app = { db, product, cart, search, payments, catalogue };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;

function deleteAs(user: User | null, id: string) {
  signInAs(user);
  return callRoute(app.product.DELETE, { method: "DELETE", params: { id } });
}

function setStatus(admin: User, id: string, status: "ACTIVE" | "INACTIVE") {
  signInAs(admin);
  return callRoute(app.product.PATCH, { method: "PATCH", params: { id }, body: { status } });
}

async function addToCart(student: User, productId: string) {
  signInAs(student);
  const added = await callRoute(app.cart.POST, { method: "POST", body: { productId, quantity: 1 } });
  assert.equal(added.status, 200, JSON.stringify(added.json));
}

test("active products come before inactive ones on every page, with and without filters", { skip }, async () => {
  const { db, catalogue } = app;
  const { categoryId, products } = await createTestCatalogue(Array.from({ length: 7 }, (_, index) => ({ name: `Sort item ${index}`, price: 100 + index })));
  // Make inactive products the most recently updated, so a naive "newest first" sort would mix them in.
  for (const product of products.slice(0, 3)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.product.update({ where: { id: product.id }, data: { status: "INACTIVE" } });
  }
  const pageSize = 2;
  const filters = { q: "Sort item", categoryId, status: "" as const, page: 1 };
  const statuses: string[] = [];
  for (let page = 1; page <= 4; page += 1) {
    const rows = await db.product.findMany({ where: catalogue.adminProductWhere({ ...filters, page }), orderBy: catalogue.ADMIN_PRODUCT_ORDER_BY, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, status: true } });
    statuses.push(...rows.map((row) => row.status));
  }
  assert.equal(statuses.length, 7, "every product appears exactly once across pages");
  assert.deepEqual(statuses, ["ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "INACTIVE", "INACTIVE", "INACTIVE"]);
  const inactiveOnly = await db.product.findMany({ where: catalogue.adminProductWhere({ ...filters, status: "INACTIVE" }), orderBy: catalogue.ADMIN_PRODUCT_ORDER_BY, select: { status: true } });
  assert.ok(inactiveOnly.length === 3 && inactiveOnly.every((row) => row.status === "INACTIVE"));
});

test("deactivating hides a product from students without deleting it", { skip }, async () => {
  const { db } = app;
  const admin = await createTestUser("ADMIN");
  const { products } = await createTestCatalogue([{ name: "Deactivate me", price: 500 }]);
  assert.equal((await setStatus(admin, products[0].id, "INACTIVE")).status, 200);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).status, "INACTIVE");
  signInAs(null);
  const found = await callRoute(app.search.GET, { path: `/api/search?q=${encodeURIComponent(products[0].name)}` });
  assert.doesNotMatch(JSON.stringify(found.json), new RegExp(products[0].id), "inactive products are not offered for purchase");
});

test("only admins can delete, and only an inactive product with no history; carts are cleaned, audit kept", { skip }, async () => {
  const { db } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  const { products } = await createTestCatalogue([{ name: "Never ordered", price: 300 }]);
  const productId = products[0].id;
  await addToCart(student, productId);

  assert.equal((await deleteAs(null, productId)).status, 403);
  assert.equal((await deleteAs(student, productId)).status, 403);
  assert.equal((await deleteAs(runner, productId)).status, 403);
  const active = await deleteAs(admin, productId);
  assert.equal(active.status, 409);
  assert.match(String(active.json.error), /Deactivate this product first/);

  assert.equal((await setStatus(admin, productId, "INACTIVE")).status, 200);
  const results = await Promise.all([deleteAs(admin, productId), deleteAs(admin, productId)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 404], "a duplicate request finds nothing left to delete");
  assert.equal(await db.product.count({ where: { id: productId } }), 0);
  assert.equal(await db.cartItem.count({ where: { productId } }), 0, "removed from the student's cart");
  const audit = await db.auditLog.findFirst({ where: { action: "PRODUCT_DELETED", resourceId: productId, actorId: admin.userId }, select: { previousState: true } });
  assert.match(JSON.stringify(audit?.previousState), /Never ordered/, "the audit row keeps what was deleted");
});

test("products with order history or an unfinished checkout cannot be deleted", { skip }, async () => {
  const { db, payments } = app;
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Ordered before", price: 700 }, { name: "Mid checkout", price: 900 }]);
  const [ordered, pending] = products;

  // A completed order references the first product.
  await addToCart(student, ordered.id);
  const location = await createTestLocation(student.userId);
  signInAs(student);
  const paid = await payments.createPaymentAttempt("OPAY", location.id, randomUUID());
  await payments.completeVerifiedPayment(trustedTestVerifiedPayment(paid));
  await setStatus(admin, ordered.id, "INACTIVE");
  const historical = await deleteAs(admin, ordered.id);
  assert.equal(historical.status, 409);
  assert.match(String(historical.json.error), /past order item.*Keep it inactive/);
  assert.equal(await db.product.count({ where: { id: ordered.id } }), 1);
  assert.equal(await db.orderItem.count({ where: { productId: ordered.id } }), 1, "order history untouched");

  // An unfinished payment's snapshot references the second product.
  await addToCart(student, pending.id);
  signInAs(student);
  await payments.createPaymentAttempt("OPAY", location.id, randomUUID());
  await setStatus(admin, pending.id, "INACTIVE");
  const inCheckout = await deleteAs(admin, pending.id);
  assert.equal(inCheckout.status, 409);
  assert.match(String(inCheckout.json.error), /unfinished payment/);
  assert.equal(await db.product.count({ where: { id: pending.id } }), 1);

  assert.equal((await deleteAs(admin, "does-not-exist")).status, 404);
});
