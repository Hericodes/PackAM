import assert from "node:assert/strict";
import { test } from "node:test";
import { ProductStatus } from "@prisma/client";
import {
  ADMIN_PRODUCT_ORDER_BY,
  adminProductsHref,
  adminProductWhere,
  parseAdminProductFilters,
  productDeletionBlocker,
} from "./admin-catalogue";

test("active products sort before inactive ones in the database, then most recently updated", () => {
  // Postgres orders an enum by declaration order; the generated client mirrors the schema's order.
  assert.deepEqual(Object.values(ProductStatus), ["ACTIVE", "INACTIVE"]);
  assert.deepEqual(ADMIN_PRODUCT_ORDER_BY, [{ status: "asc" }, { updatedAt: "desc" }, { id: "asc" }]);
});

test("filters are parsed defensively and never drop the active-first ordering", () => {
  assert.deepEqual(parseAdminProductFilters({}), { q: "", categoryId: "", status: "", stock: "", photo: "", page: 1 });
  assert.deepEqual(parseAdminProductFilters({ q: "  indomie ", category: "cat-1", status: "INACTIVE", page: "3" }), { q: "indomie", categoryId: "cat-1", status: "INACTIVE", stock: "", photo: "", page: 3 });
  assert.equal(parseAdminProductFilters({ status: "DELETED" }).status, "", "unknown statuses are ignored");
  for (const page of ["0", "-4", "abc", "2.7"]) assert.ok(parseAdminProductFilters({ page }).page >= 1, page);
  assert.equal(parseAdminProductFilters({ q: "x".repeat(500) }).q.length, 100);
  assert.deepEqual(adminProductWhere({ q: "pen", categoryId: "c", status: "ACTIVE", stock: "", photo: "", page: 1 }), { name: { contains: "pen", mode: "insensitive" }, categoryId: "c", status: "ACTIVE" });
  assert.deepEqual(adminProductWhere({ q: "", categoryId: "", status: "", stock: "", photo: "", page: 1 }), {});
});

test("pagination links keep search and filters", () => {
  assert.equal(adminProductsHref({ q: "rice meal", categoryId: "c1", status: "ACTIVE", page: 2 }), "/admin/products?q=rice+meal&category=c1&status=ACTIVE&page=2");
  assert.equal(adminProductsHref({ page: 1 }), "/admin/products");
});

test("only an inactive product with no order history or open checkout may be deleted", () => {
  assert.equal(productDeletionBlocker({ status: "INACTIVE", orderItems: 0, openCheckouts: 0 }), null);
  assert.match(productDeletionBlocker({ status: "ACTIVE", orderItems: 0, openCheckouts: 0 }) ?? "", /Deactivate this product first/);
  assert.match(productDeletionBlocker({ status: "INACTIVE", orderItems: 3, openCheckouts: 0 }) ?? "", /3 past order items.*Keep it inactive/);
  assert.match(productDeletionBlocker({ status: "INACTIVE", orderItems: 0, openCheckouts: 1 }) ?? "", /unfinished payment/);
  // Order history is the strongest reason and is reported first.
  assert.match(productDeletionBlocker({ status: "ACTIVE", orderItems: 1, openCheckouts: 2 }) ?? "", /1 past order item,/);
});

test("stock comes from what runners confirmed at shops; PackAM keeps no counts", async () => {
  const { stockState, adminProductWhere, adminProductsHref, parseAdminProductFilters } = await import("./admin-catalogue");
  assert.equal(stockState(["UNAVAILABLE", "AVAILABLE"]), "IN_STOCK", "any shop with it");
  assert.equal(stockState(["UNAVAILABLE", "UNKNOWN"]), "OUT_OF_STOCK", "shops checked, none has it");
  assert.equal(stockState(["UNKNOWN"]), "UNCHECKED");
  assert.equal(stockState([]), "UNCHECKED", "no shop linked yet");
  assert.equal(parseAdminProductFilters({ stock: "OUT_OF_STOCK" }).stock, "OUT_OF_STOCK");
  assert.equal(parseAdminProductFilters({ stock: "LOTS" }).stock, "", "unknown values are ignored");
  assert.deepEqual(adminProductWhere({ q: "", categoryId: "", status: "", stock: "IN_STOCK", photo: "", page: 1 }), { sources: { some: { availability: "AVAILABLE" } } });
  assert.deepEqual(adminProductWhere({ q: "", categoryId: "", status: "", stock: "OUT_OF_STOCK", photo: "", page: 1 }), { AND: [{ sources: { some: { availability: "UNAVAILABLE" } } }, { sources: { none: { availability: "AVAILABLE" } } }] });
  assert.equal(adminProductsHref({ stock: "UNCHECKED", page: 2 }), "/admin/products?stock=UNCHECKED&page=2");
});

test("the 'needs a photo' filter finds products with no image, so imported products are easy to finish", async () => {
  const { adminProductWhere, adminProductsHref, parseAdminProductFilters } = await import("./admin-catalogue");
  assert.equal(parseAdminProductFilters({ photo: "missing" }).photo, "missing");
  assert.equal(parseAdminProductFilters({ photo: "yes" }).photo, "");
  assert.deepEqual(adminProductWhere({ q: "", categoryId: "", status: "", stock: "", photo: "missing", page: 1 }), { OR: [{ imageUrl: null }, { imageUrl: "" }] });
  assert.equal(adminProductsHref({ photo: "missing" }), "/admin/products?photo=missing");
});
