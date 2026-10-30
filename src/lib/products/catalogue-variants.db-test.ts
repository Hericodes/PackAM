/**
 * Categories, subcategories, labels and variants end to end through the real API routes against a disposable
 * database: admin-only changes, duplicate and invalid relationships refused, browsing by subcategory and label,
 * one cart line per variant, server-side price and stock checks, atomic stock deduction at payment, and paid
 * orders keeping their variant after catalogue edits. Run with `npm run test:db` (see src/test-support/db-harness.ts).
 *
 * Names, prices and stock below are test fixtures only.
 */
import {
  asUser,
  callRoute,
  cleanupTestData,
  createTestLocation,
  createTestUser,
  dbTestSkip as skip,
  runTag,
  signInAs,
  testDb,
  trackForCleanup,
  trustedTestVerifiedPayment,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { CHECKOUT_DELIVERY_FEE } from "../checkout-pricing";

type User = Awaited<ReturnType<typeof createTestUser>>;
type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  categories: typeof import("../../app/api/admin/categories/route");
  subcategories: typeof import("../../app/api/admin/subcategories/route");
  subcategory: typeof import("../../app/api/admin/subcategories/[id]/route");
  labels: typeof import("../../app/api/admin/labels/route");
  label: typeof import("../../app/api/admin/labels/[id]/route");
  products: typeof import("../../app/api/products/route");
  product: typeof import("../../app/api/products/[id]/route");
  variants: typeof import("../../app/api/admin/products/[id]/variants/route");
  cart: typeof import("../../app/api/cart/route");
  search: typeof import("../../app/api/search/route");
  runnerOrders: typeof import("../../app/api/runner/orders/[id]/route");
  runnerMission: typeof import("../../app/api/runner/missions/[id]/route");
  payments: typeof import("../payments/payment-lifecycle");
  errors: typeof import("../payments/payment-errors");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [categories, subcategories, subcategory, labels, label, products, product, variants, cart, search, runnerOrders, runnerMission, payments, errors] = await Promise.all([
    import("../../app/api/admin/categories/route"),
    import("../../app/api/admin/subcategories/route"),
    import("../../app/api/admin/subcategories/[id]/route"),
    import("../../app/api/admin/labels/route"),
    import("../../app/api/admin/labels/[id]/route"),
    import("../../app/api/products/route"),
    import("../../app/api/products/[id]/route"),
    import("../../app/api/admin/products/[id]/variants/route"),
    import("../../app/api/cart/route"),
    import("../../app/api/search/route"),
    import("../../app/api/runner/orders/[id]/route"),
    import("../../app/api/runner/missions/[id]/route"),
    import("../payments/payment-lifecycle"),
    import("../payments/payment-errors"),
  ]);
  app = { db, categories, subcategories, subcategory, labels, label, products, product, variants, cart, search, runnerOrders, runnerMission, payments, errors };
});
after(cleanupTestData);

const tag = () => `${runTag}${randomUUID().slice(0, 4)}`;

async function createCategory(admin: User, name = `Clothing ${tag()}`) {
  signInAs(admin);
  const response = await callRoute(app.categories.POST, { method: "POST", body: { name } });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  const category = response.json.category as { id: string; slug: string };
  trackForCleanup({ categories: [category.id] });
  return category;
}

async function createSubcategory(admin: User, categoryId: string, name: string) {
  signInAs(admin);
  const response = await callRoute(app.subcategories.POST, { method: "POST", body: { categoryId, name } });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return response.json.subcategory as { id: string; slug: string };
}

async function createLabel(admin: User, name: string) {
  signInAs(admin);
  const response = await callRoute(app.labels.POST, { method: "POST", body: { name } });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  const label = response.json.label as { id: string; slug: string };
  trackForCleanup({ labels: [label.id] });
  return label;
}

async function createProduct(admin: User, body: Record<string, unknown>) {
  signInAs(admin);
  const response = await callRoute(app.products.POST, { method: "POST", body: { name: `Hoodie ${tag()}`, customerPrice: 9000, ...body } });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  const id = response.json.id as string;
  trackForCleanup({ products: [id] });
  return id;
}

type Setup = { options: Array<{ key: string; name: string; values: Array<{ key: string; value: string }> }>; variants: Array<{ valueKeys: string[]; price: number; stockQuantity: number | null; sku: string | null; active: boolean; imageUrl: string | null }> };

const saveVariants = (admin: User, productId: string, setup: Setup) => asUser(admin, () => callRoute(app.variants.PUT, { method: "PUT", params: { id: productId }, body: setup }));

/** Colour (Black, White) × Size (M, L), each with its own price and stock. */
function hoodieSetup(prices: Record<string, number>, stock: Record<string, number | null> = {}): Setup {
  const options = [
    { key: "o-colour", name: "Colour", values: [{ key: "v-black", value: "Black" }, { key: "v-white", value: "White" }] },
    { key: "o-size", name: "Size", values: [{ key: "v-m", value: "M" }, { key: "v-l", value: "L" }] },
  ];
  const variants = ["v-black", "v-white"].flatMap((colour) => ["v-m", "v-l"].map((size) => {
    const name = `${colour.slice(2)}-${size.slice(2)}`;
    return { valueKeys: [colour, size], price: prices[name] ?? 9000, stockQuantity: stock[name] ?? null, sku: null, active: true, imageUrl: null };
  }));
  return { options, variants };
}

async function variantIds(productId: string) {
  const rows = await app.db.productVariant.findMany({ where: { productId }, select: { id: true, values: { select: { optionValue: { select: { value: true } } } } } });
  return Object.fromEntries(rows.map((row) => [row.values.map((value) => value.optionValue.value.toLowerCase()).sort((a, b) => (a.length === 1 ? 1 : 0) - (b.length === 1 ? 1 : 0)).join("-"), row.id]));
}

const addToCart = (student: User, body: Record<string, unknown>) => asUser(student, () => callRoute(app.cart.POST, { method: "POST", body: { quantity: 1, ...body } }));
const cartLines = (userId: string) => app.db.cartItem.findMany({ where: { cart: { userId } }, orderBy: { createdAt: "asc" }, select: { id: true, productId: true, variantId: true, quantity: true, configKey: true } });

test("only admins can change categories, subcategories, labels and variants", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  const category = await createCategory(admin);
  const productId = await createProduct(admin, { categoryId: category.id });
  for (const user of [student, runner]) {
    signInAs(user);
    assert.equal((await callRoute(app.subcategories.POST, { method: "POST", body: { categoryId: category.id, name: "Hoodies" } })).status, 403);
    assert.equal((await callRoute(app.labels.POST, { method: "POST", body: { name: "Popular" } })).status, 403);
    assert.equal((await callRoute(app.variants.PUT, { method: "PUT", params: { id: productId }, body: hoodieSetup({}) })).status, 403);
    assert.equal((await callRoute(app.variants.GET, { params: { id: productId } })).status, 403);
  }
  signInAs(null);
  assert.equal((await callRoute(app.labels.POST, { method: "POST", body: { name: "Popular" } })).status, 403);
  assert.equal(await app.db.productVariant.count({ where: { productId } }), 0);
  assert.equal(await app.db.subcategory.count({ where: { categoryId: category.id } }), 0);
});

test("subcategories belong to one category; duplicates and mismatched products are refused", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const clothing = await createCategory(admin);
  const stationery = await createCategory(admin, `Stationery ${tag()}`);
  const hoodies = await createSubcategory(admin, clothing.id, "Hoodies");
  const pens = await createSubcategory(admin, stationery.id, "Pens");

  // The same name twice in one category is refused; in another category it's fine.
  signInAs(admin);
  assert.equal((await callRoute(app.subcategories.POST, { method: "POST", body: { categoryId: clothing.id, name: " hoodies " } })).status, 409);
  await createSubcategory(admin, stationery.id, "Hoodies");
  assert.equal((await callRoute(app.subcategories.POST, { method: "POST", body: { categoryId: "missing", name: "Caps" } })).status, 400);

  // A product's subcategory must be in its category, through the API and in the database itself.
  signInAs(admin);
  const wrong = await callRoute(app.products.POST, { method: "POST", body: { name: `Hoodie ${tag()}`, customerPrice: 9000, categoryId: clothing.id, subcategoryId: pens.id } });
  assert.equal(wrong.status, 400);
  const productId = await createProduct(admin, { categoryId: clothing.id, subcategoryId: hoodies.id });
  await assert.rejects(app.db.product.update({ where: { id: productId }, data: { subcategoryId: pens.id } }));
  await assert.rejects(app.db.subcategory.update({ where: { id: hoodies.id }, data: { categoryId: stationery.id } }), "a subcategory can't move away from its products' category");

  // Moving the product to another category clears its subcategory.
  const moved = await asUser(admin, () => callRoute(app.product.PATCH, { method: "PATCH", params: { id: productId }, body: { categoryId: stationery.id } }));
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.equal((await app.db.product.findUniqueOrThrow({ where: { id: productId }, select: { subcategoryId: true } })).subcategoryId, null);

  // Browsing a subcategory shows only its products; a hidden subcategory shows nothing.
  await asUser(admin, () => callRoute(app.product.PATCH, { method: "PATCH", params: { id: productId }, body: { categoryId: clothing.id, subcategoryId: hoodies.id } }));
  const listed = await callRoute(app.search.GET, { path: `/api/search?category=${clothing.slug}&sub=${hoodies.slug}` });
  assert.deepEqual((listed.json.products as Array<{ id: string }>).map((item) => item.id), [productId]);
  await asUser(admin, () => callRoute(app.subcategory.PATCH, { method: "PATCH", params: { id: hoodies.id }, body: { isActive: false } }));
  const hidden = await callRoute(app.search.GET, { path: `/api/search?category=${clothing.slug}&sub=${hoodies.slug}` });
  assert.equal(hidden.json.total, 0);
});

test("labels: several per product, shown on cards, filterable, and hidden labels disappear", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const category = await createCategory(admin);
  const popular = await createLabel(admin, `Popular ${tag()}`);
  const fresh = await createLabel(admin, `New ${tag()}`);
  signInAs(admin);
  assert.equal((await callRoute(app.labels.POST, { method: "POST", body: { name: `  ${(await app.db.productLabel.findUniqueOrThrow({ where: { id: popular.id } })).name.toUpperCase()} ` } })).status, 409, "no duplicate labels");

  const labelled = await createProduct(admin, { categoryId: category.id, labelIds: [popular.id, fresh.id] });
  const plain = await createProduct(admin, { categoryId: category.id });
  assert.equal((await asUser(admin, () => callRoute(app.products.POST, { method: "POST", body: { name: `Bad ${tag()}`, customerPrice: 100, categoryId: category.id, labelIds: ["missing"] } }))).status, 400);

  const byLabel = await callRoute(app.search.GET, { path: `/api/search?category=${category.slug}&label=${popular.slug}` });
  const cards = byLabel.json.products as Array<{ id: string; labels: string[] }>;
  assert.deepEqual(cards.map((card) => card.id), [labelled]);
  assert.equal(cards[0].labels.length, 2);

  // Replacing labels on edit, then hiding one.
  await asUser(admin, () => callRoute(app.product.PATCH, { method: "PATCH", params: { id: plain }, body: { labelIds: [popular.id] } }));
  await asUser(admin, () => callRoute(app.product.PATCH, { method: "PATCH", params: { id: labelled }, body: { labelIds: [fresh.id] } }));
  assert.deepEqual((await app.db.productLabelOnProduct.findMany({ where: { productId: labelled }, select: { labelId: true } })).map((row) => row.labelId), [fresh.id]);
  await asUser(admin, () => callRoute(app.label.PATCH, { method: "PATCH", params: { id: fresh.id }, body: { isActive: false } }));
  const all = await callRoute(app.search.GET, { path: `/api/search?category=${category.slug}` });
  const shown = Object.fromEntries((all.json.products as Array<{ id: string; labels: string[] }>).map((card) => [card.id, card.labels]));
  assert.equal(shown[labelled].length, 0, "a hidden label isn't shown");
  assert.equal(shown[plain].length, 1);

  // Removing a label takes it off products but never removes the products.
  assert.equal((await asUser(admin, () => callRoute(app.label.DELETE, { method: "DELETE", params: { id: popular.id } }))).status, 200);
  assert.equal(await app.db.product.count({ where: { id: { in: [labelled, plain] } } }), 2);
  assert.equal(await app.db.productLabelOnProduct.count({ where: { labelId: popular.id } }), 0);
});

test("variant setup: combinations validated, no duplicates, customer price is the cheapest, in-use variants are kept", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const category = await createCategory(admin);
  const productId = await createProduct(admin, { categoryId: category.id });

  const duplicate = hoodieSetup({});
  duplicate.variants[1] = { ...duplicate.variants[0] };
  assert.equal((await saveVariants(admin, productId, duplicate)).status, 400);
  const missingValue = hoodieSetup({});
  missingValue.variants[0] = { ...missingValue.variants[0], valueKeys: ["v-black"] };
  assert.equal((await saveVariants(admin, productId, missingValue)).status, 400);
  const sameSku = hoodieSetup({});
  sameSku.variants[0].sku = "HD-1";
  sameSku.variants[1].sku = "hd-1";
  assert.equal((await saveVariants(admin, productId, sameSku)).status, 400);
  assert.equal(await app.db.productVariant.count({ where: { productId } }), 0, "nothing saved from a bad setup");

  const saved = await saveVariants(admin, productId, hoodieSetup({ "black-m": 9500, "black-l": 10000, "white-m": 9000, "white-l": 10500 }));
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.variants, 4);
  assert.equal((await app.db.product.findUniqueOrThrow({ where: { id: productId }, select: { customerPrice: true } })).customerPrice, 9000);
  await assert.rejects(app.db.productVariant.create({ data: { productId, optionKey: (await app.db.productVariant.findFirstOrThrow({ where: { productId } })).optionKey, price: 1 } }), "the database refuses a duplicate combination");

  // Reloading and saving again keeps the same variants (matched by combination, not recreated).
  const before = await variantIds(productId);
  const loaded = await asUser(admin, () => callRoute(app.variants.GET, { params: { id: productId } }));
  const setup = loaded.json as unknown as { options: Setup["options"]; variants: Array<Setup["variants"][number] & { id: string; inUse: boolean }> };
  const resaved = await saveVariants(admin, productId, { options: setup.options, variants: setup.variants.map(({ valueKeys, price, stockQuantity, sku, active, imageUrl }) => ({ valueKeys, price, stockQuantity, sku, active, imageUrl })) });
  assert.equal(resaved.status, 200, JSON.stringify(resaved.json));
  assert.deepEqual(await variantIds(productId), before);

  // A variant in a student's cart can't be removed, only marked unavailable.
  assert.equal((await addToCart(student, { productId, variantId: before["black-m"] })).status, 200);
  const refused = await saveVariants(admin, productId, { options: setup.options, variants: setup.variants.filter((variant) => variant.id !== before["black-m"]).map(({ valueKeys, price, stockQuantity, sku, active, imageUrl }) => ({ valueKeys, price, stockQuantity, sku, active, imageUrl })) });
  assert.equal(refused.status, 409);
  assert.match(String(refused.json.error), /unavailable/);
  assert.equal(await app.db.productVariant.count({ where: { productId } }), 4);
  const disabled = await saveVariants(admin, productId, { options: setup.options, variants: setup.variants.map(({ id, valueKeys, price, stockQuantity, sku, imageUrl }) => ({ valueKeys, price, stockQuantity, sku, active: id !== before["black-m"], imageUrl })) });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.json));
  assert.equal((await app.db.productVariant.findUniqueOrThrow({ where: { id: before["black-m"] }, select: { status: true } })).status, "INACTIVE");
});

test("cart: options required, one line per variant, unavailable and foreign variants refused, stock limits enforced", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const category = await createCategory(admin);
  const productId = await createProduct(admin, { categoryId: category.id });
  const otherId = await createProduct(admin, { categoryId: category.id });
  assert.equal((await saveVariants(admin, productId, hoodieSetup({ "black-m": 9500, "white-l": 10500 }, { "black-m": 2, "white-m": 0 }))).status, 200);
  assert.equal((await saveVariants(admin, otherId, hoodieSetup({}))).status, 200);
  const ids = await variantIds(productId);
  const otherIds = await variantIds(otherId);

  const noOptions = await addToCart(student, { productId });
  assert.equal(noOptions.status, 400);
  assert.equal(noOptions.json.code, "OPTIONS_REQUIRED");
  assert.equal((await addToCart(student, { productId, variantId: otherIds["black-m"] })).status, 409, "a variant of another product");
  assert.equal((await addToCart(student, { productId, variantId: ids["white-m"] })).status, 400, "out of stock");

  assert.equal((await addToCart(student, { productId, variantId: ids["black-m"] })).status, 200);
  assert.equal((await addToCart(student, { productId, variantId: ids["white-l"], quantity: 3 })).status, 200);
  assert.equal((await addToCart(student, { productId, variantId: ids["black-m"] })).status, 200);
  const over = await addToCart(student, { productId, variantId: ids["black-m"] });
  assert.equal(over.status, 400);
  assert.match(String(over.json.error), /Only 2 left/);
  const lines = await cartLines(student.userId);
  assert.deepEqual(lines.map((line) => [line.variantId, line.quantity, line.configKey]), [[ids["black-m"], 2, `variant:${ids["black-m"]}`], [ids["white-l"], 3, `variant:${ids["white-l"]}`]]);

  const raise = await asUser(student, () => callRoute(app.cart.PATCH, { method: "PATCH", body: { itemId: lines[0].id, quantity: 3 } }));
  assert.equal(raise.status, 409);
  assert.equal((await cartLines(student.userId))[0].quantity, 2);

  // The admin marks a variant unavailable: it can't be added, and the cart can't be paid for.
  const location = await createTestLocation(student.userId);
  const setup = (await asUser(admin, () => callRoute(app.variants.GET, { params: { id: productId } }))).json as unknown as { options: Setup["options"]; variants: Array<Setup["variants"][number] & { id: string }> };
  await saveVariants(admin, productId, { options: setup.options, variants: setup.variants.map(({ id, valueKeys, price, stockQuantity, sku, imageUrl }) => ({ valueKeys, price, stockQuantity, sku, active: id !== ids["white-l"], imageUrl })) });
  assert.equal((await addToCart(student, { productId, variantId: ids["white-l"] })).status, 409);
  signInAs(student);
  await assert.rejects(app.payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 2 * 9500 + 3 * 10500 + CHECKOUT_DELIVERY_FEE), app.errors.CartNotPayableError);

  // Simple products track stock the same way.
  const simple = await createProduct(admin, { categoryId: category.id, stockQuantity: 1 });
  assert.equal((await addToCart(student, { productId: simple, quantity: 2 })).status, 400);
  assert.equal((await addToCart(student, { productId: simple, variantId: ids["black-m"] })).status, 409, "a variant can't be attached to a simple product");
});

test("checkout re-prices variants on the server; the paid order keeps its variant after catalogue edits", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const category = await createCategory(admin);
  const productId = await createProduct(admin, { categoryId: category.id });
  const setup = hoodieSetup({ "black-l": 10000 }, { "black-l": 5 });
  setup.variants.find((variant) => variant.valueKeys.join() === "v-black,v-l")!.sku = `HD-BL-${tag()}`;
  assert.equal((await saveVariants(admin, productId, setup)).status, 200);
  const ids = await variantIds(productId);
  const location = await createTestLocation(student.userId);
  assert.equal((await addToCart(student, { productId, variantId: ids["black-l"], quantity: 2 })).status, 200);

  // The admin changes the price after the student reviewed it: the student must confirm the new total.
  const reviewed = 2 * 10000 + CHECKOUT_DELIVERY_FEE;
  const loaded = (await asUser(admin, () => callRoute(app.variants.GET, { params: { id: productId } }))).json as unknown as { options: Setup["options"]; variants: Array<Setup["variants"][number] & { id: string }> };
  await saveVariants(admin, productId, { options: loaded.options, variants: loaded.variants.map(({ id, valueKeys, price, stockQuantity, sku, active, imageUrl }) => ({ valueKeys, price: id === ids["black-l"] ? 11000 : price, stockQuantity, sku, active, imageUrl })) });
  signInAs(student);
  await assert.rejects(app.payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, reviewed), (error: Error) => {
    assert.ok(error instanceof app.errors.PriceChangedError);
    assert.equal(error.revised.total, 2 * 11000 + CHECKOUT_DELIVERY_FEE);
    return true;
  });
  const attempt = await app.payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 2 * 11000 + CHECKOUT_DELIVERY_FEE);
  assert.equal(attempt.amount, 2 * 11000 + CHECKOUT_DELIVERY_FEE);
  assert.equal(await app.db.order.count({ where: { userId: student.userId } }), 0, "no order before verified payment");

  const { orderId } = await app.payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));
  const item = await app.db.orderItem.findFirstOrThrow({ where: { orderId: orderId! }, select: { id: true, productName: true, unitPrice: true, quantity: true, variantId: true, details: true } });
  assert.equal(item.variantId, ids["black-l"]);
  assert.equal(item.unitPrice, 11000);
  assert.deepEqual(item.details, { kind: "VARIANT", variantId: ids["black-l"], sku: setup.variants.find((variant) => variant.valueKeys.join() === "v-black,v-l")!.sku, options: [{ name: "Colour", value: "Black" }, { name: "Size", value: "L" }] });
  assert.equal((await app.db.productVariant.findUniqueOrThrow({ where: { id: ids["black-l"] }, select: { stockQuantity: true } })).stockQuantity, 3, "stock went down by what was paid for");
  assert.equal((await cartLines(student.userId)).length, 0);

  // The runner sees exactly which option to buy.
  assert.equal((await asUser(runner, () => callRoute(app.runnerOrders.POST, { method: "POST", params: { id: orderId! }, body: { action: "accept" } }))).status, 200);
  const mission = await asUser(runner, () => callRoute(app.runnerMission.GET, { params: { id: orderId! } }));
  assert.equal((mission.json.mission as { items: Array<{ options: string | null }> }).items[0].options, "Colour: Black · Size: L");

  // Renaming the options, repricing, and finally deleting the variant never changes the paid order.
  const options = loaded.options.map((option) => ({ ...option, name: option.name === "Colour" ? "Shade" : option.name }));
  const variants = loaded.variants.map(({ id, valueKeys, stockQuantity, sku, active, imageUrl }) => ({ id, valueKeys, price: 15000, stockQuantity, sku, active, imageUrl }));
  const strip = (list: typeof variants) => list.map(({ valueKeys, price, stockQuantity, sku, active, imageUrl }) => ({ valueKeys, price, stockQuantity, sku, active, imageUrl }));
  assert.equal((await saveVariants(admin, productId, { options, variants: strip(variants) })).status, 200);
  const removal = await saveVariants(admin, productId, { options, variants: strip(variants.filter((variant) => variant.id !== ids["black-l"])) });
  assert.equal(removal.status, 409, "an ordered variant is kept, so the order still links to it");
  // Even if a variant row is removed directly, the order only loses the link, never its details.
  await app.db.productVariant.delete({ where: { id: ids["black-l"] } });
  const afterEdits = await app.db.orderItem.findUniqueOrThrow({ where: { id: item.id }, select: { id: true, productName: true, unitPrice: true, quantity: true, variantId: true, details: true } });
  assert.deepEqual(afterEdits, { ...item, variantId: null });
});

test("stock deduction is atomic: two paid orders for the last unit never oversell, and admins are told", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const [first, second] = [await createTestUser("STUDENT"), await createTestUser("STUDENT")];
  const category = await createCategory(admin);
  const productId = await createProduct(admin, { categoryId: category.id });
  assert.equal((await saveVariants(admin, productId, hoodieSetup({ "white-m": 8000 }, { "white-m": 1 }))).status, 200);
  const ids = await variantIds(productId);

  // Both carts are valid (1 left), so both payments start; the money is verified for both.
  const attempts = [];
  for (const student of [first, second]) {
    assert.equal((await addToCart(student, { productId, variantId: ids["white-m"] })).status, 200);
    const location = await createTestLocation(student.userId);
    signInAs(student);
    attempts.push(await app.payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 8000 + CHECKOUT_DELIVERY_FEE));
  }
  const verified = attempts.map((attempt) => trustedTestVerifiedPayment(attempt));
  const results = await Promise.all(verified.map((payment) => app.payments.completeVerifiedPayment(payment)));
  assert.ok(results.every((result) => result.orderId), "a verified payment always becomes an order");
  assert.equal((await app.db.productVariant.findUniqueOrThrow({ where: { id: ids["white-m"] }, select: { stockQuantity: true } })).stockQuantity, 0, "never below zero");
  const alerts = await app.db.notification.findMany({ where: { userId: admin.userId, title: "Stock ran out for a paid order" }, select: { orderId: true } });
  assert.equal(alerts.length, 1, "exactly one order came up short, and the admin was told");

  // Replaying the same verified payment (e.g. a repeated webhook) changes nothing.
  assert.equal((await app.payments.completeVerifiedPayment(verified[0])).orderId, results[0].orderId);
  assert.equal(await app.db.order.count({ where: { userId: { in: [first.userId, second.userId] } } }), 2);
  assert.equal((await app.db.productVariant.findUniqueOrThrow({ where: { id: ids["white-m"] }, select: { stockQuantity: true } })).stockQuantity, 0);
});
