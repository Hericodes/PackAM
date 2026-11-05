/**
 * Food end to end through the real API routes against a disposable database: admin-only shop and menu
 * management, what students can see, plate pricing and cart lines, Food/Order Stuff cart boundaries,
 * price confirmation, closed shops, verified payment before any order, the shop lock for runners, and
 * historical orders surviving menu edits. Run with `npm run test:db` (see src/test-support/db-harness.ts).
 */
import {
  asUser,
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  createTestVendor,
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
import { describeDetails } from "./plate";

type User = Awaited<ReturnType<typeof createTestUser>>;
type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  shops: typeof import("../../app/api/admin/food/shops/route");
  shop: typeof import("../../app/api/admin/food/shops/[id]/route");
  items: typeof import("../../app/api/admin/food/shops/[id]/items/route");
  item: typeof import("../../app/api/admin/food/items/[id]/route");
  foodCart: typeof import("../../app/api/food/cart/route");
  cart: typeof import("../../app/api/cart/route");
  search: typeof import("../../app/api/search/route");
  runnerOrders: typeof import("../../app/api/runner/orders/[id]/route");
  runnerMission: typeof import("../../app/api/runner/missions/[id]/route");
  paymentCreate: typeof import("../../app/api/payments/create/route");
  payments: typeof import("../payments/payment-lifecycle");
  errors: typeof import("../payments/payment-errors");
  foodShops: typeof import("./shops");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [shops, shop, items, item, foodCart, cart, search, runnerOrders, runnerMission, paymentCreate, payments, errors, foodShops] = await Promise.all([
    import("../../app/api/admin/food/shops/route"),
    import("../../app/api/admin/food/shops/[id]/route"),
    import("../../app/api/admin/food/shops/[id]/items/route"),
    import("../../app/api/admin/food/items/[id]/route"),
    import("../../app/api/food/cart/route"),
    import("../../app/api/cart/route"),
    import("../../app/api/search/route"),
    import("../../app/api/runner/orders/[id]/route"),
    import("../../app/api/runner/missions/[id]/route"),
    import("../../app/api/payments/create/route"),
    import("../payments/payment-lifecycle"),
    import("../payments/payment-errors"),
    import("./shops"),
  ]);
  app = { db, shops, shop, items, item, foodCart, cart, search, runnerOrders, runnerMission, paymentCreate, payments, errors, foodShops };
});
after(cleanupTestData);

/** A shop built through the admin API, with a menu. Names and prices are test fixtures only. */
async function buildShop(admin: User, name: string, options: { open?: boolean; listed?: boolean } = {}) {
  signInAs(admin);
  const created = await callRoute(app.shops.POST, { method: "POST", body: { name: `${name} ${runTag}`, description: "Test kitchen", location: "Behind the test hall" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const shopId = created.json.id as string;
  trackForCleanup({ vendors: [shopId] });
  assert.equal((await callRoute(app.shop.PATCH, { method: "PATCH", params: { id: shopId }, body: { foodPackFee: 0 } })).status, 200, "test shops charge no pack unless a test sets one");
  const add = async (body: Record<string, unknown>) => {
    const response = await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { available: true, ...body } });
    assert.equal(response.status, 201, JSON.stringify(response.json));
    trackForCleanup({ products: [response.json.id as string] });
    return response.json.id as string;
  };
  const ids = {
    meal: await add({ name: "Jollof combo", role: "MEAL", price: 1500, section: "Rice and meals" }),
    rice: await add({ name: "White rice", role: "BASE", group: "RICE", price: 500 }),
    amala: await add({ name: "Amala", role: "BASE", group: "SWALLOW", price: 400, section: "Swallow and soup" }),
    ewedu: await add({ name: "Ewedu", role: "SOUP", price: 200 }),
    meat: await add({ name: "Meat", role: "EXTRA", group: "PROTEIN", price: 300 }),
    ponmo: await add({ name: "Ponmo", role: "EXTRA", group: "PROTEIN", price: 150, maxPerPlate: 2 }),
    hidden: await add({ name: "Egg", role: "EXTRA", group: "PROTEIN", price: 250, available: false }),
  };
  if (options.listed ?? true) assert.equal((await callRoute(app.shop.PATCH, { method: "PATCH", params: { id: shopId }, body: { listedInFood: true } })).status, 200);
  if (options.open ?? true) assert.equal((await callRoute(app.shop.PATCH, { method: "PATCH", params: { id: shopId }, body: { isOpen: true } })).status, 200);
  return { shopId, ids };
}

const addFood = (student: User, shopId: string, line: Record<string, unknown>, clearCart = false) =>
  asUser(student, () => callRoute(app.foodCart.POST, { method: "POST", body: { shopId, line, ...(clearCart ? { clearCart: true } : {}) } }));
const plate = (ids: Awaited<ReturnType<typeof buildShop>>["ids"], extras: Array<[string, number]>, quantity = 1) =>
  ({ kind: "PLATE", baseId: ids.amala, soupId: ids.ewedu, extras: extras.map(([productId, q]) => ({ productId, quantity: q })), quantity });
const cartLines = (userId: string) => app.db.cartItem.findMany({ where: { cart: { userId } }, orderBy: { createdAt: "asc" }, select: { productId: true, quantity: true, configKey: true, extras: { select: { productId: true, quantity: true } } } });

test("only admins can create or change food shops and menu items", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const { shopId, ids } = await buildShop(admin, "Auth kitchen");
  for (const user of [null, await createTestUser("STUDENT"), await createTestUser("RUNNER", { isVerified: true, isAvailable: true })]) {
    signInAs(user);
    const who = user?.role ?? "signed out";
    assert.equal((await callRoute(app.shops.POST, { method: "POST", body: { name: "Sneaky shop" } })).status, 403, `${who}: create shop`);
    assert.equal((await callRoute(app.shop.PATCH, { method: "PATCH", params: { id: shopId }, body: { isOpen: false } })).status, 403, `${who}: close shop`);
    assert.equal((await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { name: "x", role: "MEAL", price: 1 } })).status, 403, `${who}: add item`);
    assert.equal((await callRoute(app.item.PATCH, { method: "PATCH", params: { id: ids.meal }, body: { price: 1 } })).status, 403, `${who}: change price`);
  }
  const meal = await app.db.product.findUniqueOrThrow({ where: { id: ids.meal }, select: { customerPrice: true } });
  assert.equal(meal.customerPrice, 1500);
  assert.equal(await app.db.vendor.count({ where: { name: "Sneaky shop" } }), 0);

  signInAs(admin);
  assert.equal((await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { name: "Free plantain", role: "EXTRA", group: "SIDE", price: 0 } })).status, 400, "only soups may be free");
  assert.equal((await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { name: "Ungrouped beef", role: "EXTRA", price: 300 } })).status, 400, "a new add-on needs a group");
  assert.equal((await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { name: "Big meat", role: "EXTRA", group: "PROTEIN", price: 300, maxPerPlate: 100 } })).status, 400, "a per-plate limit is at most 99");
  assert.equal((await callRoute(app.shops.POST, { method: "POST", body: { name: "Opens at once", isOpen: true } })).status, 400, "a new shop starts closed and hidden");
});

test("students see only listed shops, only available items, and never internal vendor details", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const listed = await buildShop(admin, "Listed kitchen");
  const unlisted = await buildShop(admin, "Unlisted kitchen", { listed: false });
  await app.db.vendor.update({ where: { id: listed.shopId }, data: { phone: "08099999999", notes: "internal: owner owes us", reliabilityScore: 2 } });

  const shops = await app.foodShops.listFoodShops();
  assert.ok(shops.some((shop) => shop.id === listed.shopId));
  assert.ok(!shops.some((shop) => shop.id === unlisted.shopId), "unlisted shops are invisible");
  assert.doesNotMatch(JSON.stringify(shops), /08099999999|owner owes|reliability/, "no phone, notes or reliability on student pages");
  assert.equal(await app.foodShops.getFoodShop(unlisted.shopId), null);
  const menu = await app.foodShops.getShopMenu(listed.shopId);
  assert.ok(!menu.some((item) => item.id === listed.ids.hidden), "hidden items are not on the menu");

  const student = await createTestUser("STUDENT");
  assert.equal((await addFood(student, unlisted.shopId, { kind: "MEAL", productId: unlisted.ids.meal, quantity: 1 })).status, 404, "an unlisted shop takes no orders");
  assert.equal((await addFood(student, listed.shopId, plate(listed.ids, [[listed.ids.hidden, 1]]))).status, 400, "a hidden extra can't be chosen");
  assert.equal((await addFood(student, listed.shopId, { kind: "MEAL", productId: unlisted.ids.meal, quantity: 1 })).status, 400, "another shop's meal can't be added here");

  // Food never leaks into Order Stuff.
  const searched = await callRoute(app.search.GET, { path: `/api/search?q=${encodeURIComponent("Jollof combo")}` });
  assert.ok(!JSON.stringify(searched.json).includes(listed.ids.meal), "food menu items are not Order Stuff products");
  signInAs(student);
  assert.equal((await callRoute(app.cart.POST, { method: "POST", body: { productId: listed.ids.meal, quantity: 1 } })).status, 404, "the Order Stuff cart refuses food items");
});

test("plates are priced on the server; identical plates merge, different plates stay separate; extras capped", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const { shopId, ids } = await buildShop(admin, "Plate kitchen");
  const student = await createTestUser("STUDENT");

  const first = await addFood(student, shopId, plate(ids, [[ids.meat, 2], [ids.ponmo, 1]]));
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.deepEqual(first.json.added, { name: "Amala", unitPrice: 400 + 200 + 600 + 150, quantity: 1 });
  // The same plate with the choices listed in another order: one line, quantity 2.
  assert.equal((await addFood(student, shopId, plate(ids, [[ids.ponmo, 1], [ids.meat, 2]]))).status, 200);
  // A different plate on the same base: its own line.
  assert.equal((await addFood(student, shopId, plate(ids, [[ids.meat, 1]]))).status, 200);
  // A ready-made meal.
  assert.equal((await addFood(student, shopId, { kind: "MEAL", productId: ids.meal, quantity: 2 })).status, 200);
  const lines = await cartLines(student.userId);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].quantity, 2, "identical plates merged");
  assert.equal(lines[1].quantity, 1, "different extras stay a separate line");
  assert.deepEqual(lines[0].extras.map((extra) => extra.quantity).sort(), [1, 1, 2], "soup and extras stored with the line");

  signInAs(student);
  const summary = await callRoute(app.cart.GET);
  assert.equal((summary.json.summary as { subtotal: number }).subtotal, 2 * 1350 + (400 + 200 + 300) + 2 * 1500, "cart summary uses plate prices, not the base price");

  // No limit unless the admin set one: 12 meat is fine (the database allows up to 99), 100 is refused.
  const hungry = await createTestUser("STUDENT");
  const big = await addFood(hungry, shopId, plate(ids, [[ids.meat, 12]]));
  assert.equal(big.status, 200, "as much meat as the student wants");
  assert.deepEqual((await cartLines(hungry.userId)).flatMap((line) => line.extras).find((extra) => extra.productId === ids.meat), { productId: ids.meat, quantity: 12 }, "stored as 12");
  assert.equal((await addFood(hungry, shopId, plate(ids, [[ids.meat, 100]]))).status, 400, "the safety ceiling is 99");
  const ponmo = await addFood(student, shopId, plate(ids, [[ids.ponmo, 3]]));
  assert.equal(ponmo.status, 400, "the admin's lower limit applies");
  assert.match(String(ponmo.json.error), /Ponmo up to 2/);
  assert.equal((await addFood(student, shopId, { kind: "PLATE", baseId: ids.ewedu, quantity: 1 })).status, 400, "a soup is not a base");
  assert.equal((await addFood(student, shopId, { ...plate(ids, []), soupId: ids.meat })).status, 400, "an extra is not a soup");
  assert.equal((await cartLines(student.userId)).length, 3, "refused additions changed nothing");
});

test("Food and Order Stuff never share a cart, and the cart is cleared only when the student chooses", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const a = await buildShop(admin, "Shop A");
  const b = await buildShop(admin, "Shop B");
  const { products: [pen] } = await createTestCatalogue([{ name: "Boundary pen", price: 100 }]);
  const student = await createTestUser("STUDENT");

  assert.equal((await addFood(student, a.shopId, { kind: "MEAL", productId: a.ids.meal, quantity: 1 })).status, 200);
  const otherShop = await addFood(student, b.shopId, { kind: "MEAL", productId: b.ids.meal, quantity: 1 });
  assert.equal(otherShop.status, 409);
  assert.equal(otherShop.json.code, "CART_CONTEXT");
  assert.match(String(otherShop.json.error), /One food order comes from one shop/);
  signInAs(student);
  const stuff = await callRoute(app.cart.POST, { method: "POST", body: { productId: pen.id, quantity: 1 } });
  assert.equal(stuff.status, 409, "Order Stuff can't join a food cart");
  assert.deepEqual((await cartLines(student.userId)).map((line) => line.productId), [a.ids.meal], "nothing was merged or removed");

  // The student explicitly chooses to clear the cart and switch.
  signInAs(student);
  const switched = await callRoute(app.cart.POST, { method: "POST", body: { productId: pen.id, quantity: 1, clearCart: true } });
  assert.equal(switched.status, 200);
  assert.deepEqual((await cartLines(student.userId)).map((line) => line.productId), [pen.id]);
  const backToFood = await addFood(student, a.shopId, { kind: "MEAL", productId: a.ids.meal, quantity: 1 });
  assert.equal(backToFood.status, 409, "food can't join an Order Stuff cart either");
  assert.deepEqual((await cartLines(student.userId)).map((line) => line.productId), [pen.id]);
});

test("closed shops and changed menus are checked again at payment; a changed total needs confirmation", { skip }, async () => {
  const { db, payments, errors } = app;
  const admin = await createTestUser("ADMIN");
  const { shopId, ids } = await buildShop(admin, "Checkout kitchen");
  const student = await createTestUser("STUDENT");
  const location = await createTestLocation(student.userId);
  assert.equal((await addFood(student, shopId, plate(ids, [[ids.meat, 1]]))).status, 200);
  const reviewed = 400 + 200 + 300 + 200;

  // The shop closes after the plate was added.
  signInAs(admin);
  await callRoute(app.shop.PATCH, { method: "PATCH", params: { id: shopId }, body: { isOpen: false } });
  signInAs(student);
  await assert.rejects(payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, reviewed), (error: Error) => error instanceof errors.CartNotPayableError && /closed/.test(error.message));
  assert.equal((await addFood(student, shopId, { kind: "MEAL", productId: ids.meal, quantity: 1 })).json.code, "SHOP_CLOSED");
  signInAs(admin);
  await callRoute(app.shop.PATCH, { method: "PATCH", params: { id: shopId }, body: { isOpen: true } });

  // The admin raises the price of meat: the student must confirm the new total.
  await callRoute(app.item.PATCH, { method: "PATCH", params: { id: ids.meat }, body: { price: 350 } });
  signInAs(student);
  // Through the real payment route: the reviewed total is required, and a stale one returns the new breakdown.
  const pay = (body: Record<string, unknown>) => asUser(student, () => callRoute(app.paymentCreate.POST, { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: { deliveryLocationId: location.id, ...body } }));
  assert.equal((await pay({})).status, 400, "no reviewed total, no payment");
  const stale = await pay({ reviewedTotal: reviewed });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "PRICE_CHANGED");
  assert.deepEqual((stale.json.revised as { total: number; reviewedTotal: number }), { ...(stale.json.revised as object), total: 1150, reviewedTotal: reviewed });
  const before = await db.payment.count({ where: { userId: student.userId } });
  await assert.rejects(payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, reviewed), (error: Error) => {
    assert.ok(error instanceof errors.PriceChangedError);
    assert.deepEqual([error.revised.subtotal, error.revised.deliveryFee, error.revised.total, error.revised.reviewedTotal], [950, 200, 1150, reviewed]);
    return true;
  });
  assert.equal(await db.payment.count({ where: { userId: student.userId } }), before, "nothing is created until the student confirms");
  const confirmed = await payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 1150);
  assert.equal(confirmed.amount, 1150, "charged exactly the confirmed total");

  // An extra that becomes unavailable blocks payment.
  signInAs(admin);
  await callRoute(app.item.PATCH, { method: "PATCH", params: { id: ids.meat }, body: { available: false } });
  signInAs(student);
  await assert.rejects(payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 1150), errors.CartNotPayableError);
});

test("a food order exists only after verified payment, keeps its shop and plate, and its history survives menu edits", { skip }, async () => {
  const { db, payments, runnerOrders, runnerMission } = app;
  const admin = await createTestUser("ADMIN");
  const { shopId, ids } = await buildShop(admin, "Order kitchen");
  const otherVendor = await createTestVendor("Somewhere else");
  const student = await createTestUser("STUDENT");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const location = await createTestLocation(student.userId);
  assert.equal((await addFood(student, shopId, plate(ids, [[ids.meat, 2]], 2))).status, 200);
  assert.equal((await addFood(student, shopId, { kind: "MEAL", productId: ids.meal, quantity: 1 })).status, 200);

  signInAs(student);
  const attempt = await payments.createPaymentAttempt("OPAY", location.id, randomUUID(), null, 2 * 1200 + 1500 + 200);
  assert.equal(await db.order.count({ where: { userId: student.userId } }), 0, "no order before the provider confirms payment");
  const { orderId } = await payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId! }, select: { shopId: true, subtotal: true, deliveryFee: true, total: true, items: { orderBy: { totalPrice: "desc" }, select: { id: true, productName: true, unitPrice: true, quantity: true, totalPrice: true, details: true } } } });
  assert.equal(order.shopId, shopId);
  assert.deepEqual([order.subtotal, order.deliveryFee, order.total], [3900, 200, 4100]);
  const [platesLine, mealLine] = order.items;
  assert.deepEqual([platesLine.productName, platesLine.unitPrice, platesLine.quantity, platesLine.totalPrice], ["Amala", 1200, 2, 2400]);
  assert.deepEqual(platesLine.details, { kind: "PLATE", base: { id: ids.amala, name: "Amala", price: 400 }, soup: { id: ids.ewedu, name: "Ewedu", price: 200 }, extras: [{ id: ids.meat, name: "Meat", price: 300, quantity: 2, total: 600 }] });
  assert.equal((mealLine.details as { kind: string }).kind, "MEAL");
  assert.equal((await cartLines(student.userId)).length, 0, "the paid items left the cart");

  // The runner must buy from the student's shop.
  const accepted = await asUser(runner, () => callRoute(runnerOrders.POST, { method: "POST", params: { id: orderId! }, body: { action: "accept" } }));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
  const mission = await asUser(runner, () => callRoute(runnerMission.GET, { params: { id: orderId! } }));
  const missionJson = mission.json.mission as { shop: { id: string; name: string }; items: Array<{ plate: string | null }> };
  assert.equal(missionJson.shop.id, shopId);
  assert.ok(missionJson.items.some((item) => item.plate === "Amala + Ewedu + Meat ×2"), "the runner sees what is on the plate");
  const elsewhere = await asUser(runner, () => callRoute(runnerOrders.POST, { method: "POST", params: { id: orderId! }, body: { action: "source", orderItemId: platesLine.id, vendorId: otherVendor.id, result: "AVAILABLE", quantity: 2, actualUnitPrice: 1200 } }));
  assert.notEqual(elsewhere.status, 200);
  assert.match(String(elsewhere.json.error), /must be bought from/);
  assert.equal(await db.orderItemSourcing.count({ where: { orderItemId: platesLine.id } }), 0);
  const fromShop = await asUser(runner, () => callRoute(runnerOrders.POST, { method: "POST", params: { id: orderId! }, body: { action: "source", orderItemId: platesLine.id, vendorId: shopId, result: "AVAILABLE", quantity: 2, actualUnitPrice: 1200 } }));
  assert.equal(fromShop.status, 200, JSON.stringify(fromShop.json));

  // The admin renames and reprices the menu, and hides the meal: the paid order doesn't change.
  signInAs(admin);
  await callRoute(app.item.PATCH, { method: "PATCH", params: { id: ids.amala }, body: { name: "Amala (big)", price: 900 } });
  await callRoute(app.item.PATCH, { method: "PATCH", params: { id: ids.meat }, body: { price: 999 } });
  await callRoute(app.item.PATCH, { method: "PATCH", params: { id: ids.meal }, body: { available: false } });
  const after = await db.orderItem.findUniqueOrThrow({ where: { id: platesLine.id }, select: { productName: true, unitPrice: true, totalPrice: true, details: true } });
  assert.deepEqual(after, { productName: platesLine.productName, unitPrice: platesLine.unitPrice, totalPrice: platesLine.totalPrice, details: platesLine.details });
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId! }, select: { total: true } })).total, 4100);
});

test("food groups: free soups, swallow needs soup, rice takes none, and the database enforces the pairings", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const { shopId, ids } = await buildShop(admin, "Grouped kitchen");
  signInAs(admin);
  const freeSoup = await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { name: "Efo", role: "SOUP", price: 0, available: true } });
  assert.equal(freeSoup.status, 201, JSON.stringify(freeSoup.json));
  const efo = (freeSoup.json as { id: string }).id;
  trackForCleanup({ products: [efo] });
  assert.equal((await app.db.product.findUniqueOrThrow({ where: { id: efo } })).status, "ACTIVE", "an active free soup is allowed");

  // The student menu shows the free soup and the groups.
  const menu = await app.foodShops.getShopMenu(shopId);
  assert.equal(menu.find((item) => item.id === efo)?.price, 0);
  assert.deepEqual(menu.filter((item) => item.role === "BASE").map((item) => [item.name, item.group]).sort(), [["Amala", "SWALLOW"], ["White rice", "RICE"]]);

  const lineFor = (body: Record<string, unknown>) => addFood(student, shopId, { kind: "PLATE", quantity: 1, ...body });
  assert.equal((await lineFor({ baseId: ids.amala })).status, 400, "swallow without soup is refused");
  assert.equal((await lineFor({ baseId: ids.rice, soupId: efo })).status, 400, "rice with soup is refused");
  const swallow = await lineFor({ baseId: ids.amala, soupId: efo, extras: [{ productId: ids.meat, quantity: 1 }] });
  assert.equal(swallow.status, 200, JSON.stringify(swallow.json));
  assert.equal((swallow.json as { added: { unitPrice: number } }).added.unitPrice, 400 + 0 + 300, "the free soup adds nothing");
  assert.equal((await lineFor({ baseId: ids.rice, extras: [{ productId: ids.ponmo, quantity: 1 }] })).status, 200);

  // The database itself refuses a wrong pairing, a group on a non-food product, and a ₦0 product that isn't a soup.
  await assert.rejects(app.db.product.update({ where: { id: ids.rice }, data: { foodGroup: "PROTEIN" } }), /Product_food_group_matches_role_check|check constraint/i);
  await assert.rejects(app.db.product.update({ where: { id: ids.meal }, data: { foodGroup: "RICE" } }), /Product_food_group_matches_role_check|check constraint/i);
  await assert.rejects(app.db.product.update({ where: { id: ids.meat }, data: { customerPrice: 0 } }), /Product_active_requires_price_check|check constraint/i);
});

test("mixed plates: several items by the spoon, stored and re-priced exactly, merged when identical; swallow stays on its own plate", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  const { shopId, ids } = await buildShop(admin, "Mixing kitchen");
  signInAs(admin);
  const beansResponse = await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { name: "Beans", role: "BASE", group: "OTHER", price: 250, available: true } });
  assert.equal(beansResponse.status, 201, JSON.stringify(beansResponse.json));
  const beans = beansResponse.json.id as string;
  trackForCleanup({ products: [beans] });

  const mixed = (order: Array<[string, number]>) => ({ kind: "PLATE", bases: order.map(([productId, quantity]) => ({ productId, quantity })), extras: [{ productId: ids.meat, quantity: 3 }], quantity: 1 });
  const first = await addFood(student, shopId, mixed([[ids.rice, 2], [beans, 1]]));
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal((first.json as { added: { unitPrice: number } }).added.unitPrice, 2 * 500 + 250 + 3 * 300, "priced per spoon");
  const lines = await cartLines(student.userId);
  assert.equal(lines.length, 1);
  assert.deepEqual([...lines[0].extras].sort((a, b) => a.productId.localeCompare(b.productId)), [{ productId: ids.rice, quantity: 2 }, { productId: beans, quantity: 1 }, { productId: ids.meat, quantity: 3 }].sort((a, b) => a.productId.localeCompare(b.productId)), "every item is stored with its spoons");

  // The same plate picked in the other order merges into the same line.
  assert.equal((await addFood(student, shopId, mixed([[beans, 1], [ids.rice, 2]]))).status, 200);
  const merged = await cartLines(student.userId);
  assert.deepEqual(merged.map((line) => line.quantity), [2], "two identical plates, one line");

  // Re-priced from the stored rows, as checkout does.
  const { priceCart } = await import("../cart-pricing");
  const priced = await priceCart(app.db, student.userId);
  assert.deepEqual(priced.lines.map((line) => [line.unitPrice, line.quantity, line.problem]), [[2150, 2, null]]);
  assert.equal(priced.lines[0].details?.kind === "PLATE" && describeDetails(priced.lines[0].details), "White rice \u00d72 + Beans + Meat \u00d73");

  // Swallow can't share a plate with rice or others.
  const swallowAndRice = await addFood(student, shopId, { kind: "PLATE", bases: [{ productId: ids.amala, quantity: 1 }, { productId: ids.rice, quantity: 1 }], soupId: ids.ewedu, quantity: 1 });
  assert.equal(swallowAndRice.status, 400);
  assert.match(String(swallowAndRice.json.error), /Swallow comes on its own plate/);
  // Wraps of swallow with soup are fine, and an old tab sending baseId still works.
  assert.equal((await addFood(student, shopId, { kind: "PLATE", bases: [{ productId: ids.amala, quantity: 3 }], soupId: ids.ewedu, quantity: 1 })).status, 200);
  assert.equal((await addFood(student, shopId, { kind: "PLATE", baseId: ids.amala, soupId: ids.ewedu, quantity: 1 })).status, 200);
});

test("takeaway pack: a new shop starts at \u20a6300, one pack per plate and meal, and re-priced when the admin changes it", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const student = await createTestUser("STUDENT");
  signInAs(admin);
  const fresh = await callRoute(app.shops.POST, { method: "POST", body: { name: `Pack default ${runTag}` } });
  assert.equal(fresh.status, 201);
  trackForCleanup({ vendors: [fresh.json.id as string] });
  assert.equal((await app.db.vendor.findUniqueOrThrow({ where: { id: fresh.json.id as string } })).foodPackFee, 300, "new shops start at \u20a6300");

  const { shopId, ids } = await buildShop(admin, "Pack kitchen");
  signInAs(admin);
  assert.equal((await callRoute(app.shop.PATCH, { method: "PATCH", params: { id: shopId }, body: { foodPackFee: 300 } })).status, 200);
  assert.equal((await callRoute(app.shop.PATCH, { method: "PATCH", params: { id: shopId }, body: { foodPackFee: -5 } })).status, 400);

  const plate = await addFood(student, shopId, { kind: "PLATE", bases: [{ productId: ids.rice, quantity: 2 }], extras: [{ productId: ids.meat, quantity: 1 }], quantity: 2 });
  assert.equal(plate.status, 200, JSON.stringify(plate.json));
  assert.equal((plate.json as { added: { unitPrice: number } }).added.unitPrice, 2 * 500 + 300 + 300, "items + meat + one pack");
  const meal = await addFood(student, shopId, { kind: "MEAL", productId: ids.meal, quantity: 1 });
  assert.equal((meal.json as { added: { unitPrice: number } }).added.unitPrice, 1500 + 300);

  const { priceCart } = await import("../cart-pricing");
  const before = await priceCart(app.db, student.userId);
  assert.equal(before.subtotal, 2 * 1600 + 1800, "two plates and a meal: three packs");
  assert.ok(before.lines.every((line) => line.details && "pack" in line.details && line.details.pack?.price === 300));

  // The admin changes the pack price: the cart is priced again (checkout then asks the student to confirm).
  signInAs(admin);
  assert.equal((await callRoute(app.shop.PATCH, { method: "PATCH", params: { id: shopId }, body: { foodPackFee: 200 } })).status, 200);
  const after = await priceCart(app.db, student.userId);
  assert.equal(after.subtotal, 2 * 1500 + 1700);
  assert.equal(await app.db.auditLog.count({ where: { actorId: admin.userId, resourceId: shopId, newState: { path: ["foodPackFee"], equals: 200 } } }), 1, "audited");
});
