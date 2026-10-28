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
  const add = async (body: Record<string, unknown>) => {
    const response = await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { available: true, ...body } });
    assert.equal(response.status, 201, JSON.stringify(response.json));
    trackForCleanup({ products: [response.json.id as string] });
    return response.json.id as string;
  };
  const ids = {
    meal: await add({ name: "Jollof combo", role: "MEAL", price: 1500, section: "Rice and meals" }),
    rice: await add({ name: "White rice", role: "BASE", price: 500 }),
    amala: await add({ name: "Amala", role: "BASE", price: 400, section: "Swallow and soup" }),
    ewedu: await add({ name: "Ewedu", role: "SOUP", price: 200 }),
    meat: await add({ name: "Meat", role: "EXTRA", price: 300 }),
    ponmo: await add({ name: "Ponmo", role: "EXTRA", price: 150, maxPerPlate: 2 }),
    hidden: await add({ name: "Egg", role: "EXTRA", price: 250, available: false }),
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
  assert.equal((await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { name: "Free soup", role: "SOUP", price: 0 } })).status, 400, "every item needs a price of at least ₦1");
  assert.equal((await callRoute(app.items.POST, { method: "POST", params: { id: shopId }, body: { name: "Big meat", role: "EXTRA", price: 300, maxPerPlate: 6 } })).status, 400, "per-plate limit is at most 5");
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

  assert.equal((await addFood(student, shopId, plate(ids, [[ids.meat, 6]]))).status, 400, "no more than 5 of an extra");
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
