/**
 * Delivery locations against a disposable database: the one-field save, authorization, and the
 * chosen location (with any GPS pin and instructions) reaching the order a runner sees.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestUser,
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
  locations: typeof import("../app/api/locations/route");
  cart: typeof import("../app/api/cart/route");
  payments: typeof import("./payments/payment-lifecycle");
  choice: typeof import("./location-choice");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [locations, cart, payments, choice] = await Promise.all([
    import("../app/api/locations/route"),
    import("../app/api/cart/route"),
    import("./payments/payment-lifecycle"),
    import("./location-choice"),
  ]);
  app = { db, locations, cart, payments, choice };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;
type SavedLocation = { id: string; label: string; latitude: number | null };
const locationOf = (response: { json: Record<string, unknown> }) => response.json.location as SavedLocation;
function saveLocation(user: User | null, body: Record<string, unknown>) {
  signInAs(user);
  return callRoute(app.locations.POST, { method: "POST", body });
}

test("a location saves with just the written address; the name is derived", { skip }, async () => {
  const student = await createTestUser("STUDENT");
  const saved = await saveLocation(student, { address: "Test Hall B, Room 4, by the water tank" });
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  assert.equal(locationOf(saved).label, "Test Hall B");
  assert.equal(locationOf(saved).latitude, null, "no GPS pin is invented");

  const named = await saveLocation(student, { label: "My room", address: "Test Hall B, Room 4" });
  assert.equal(locationOf(named).label, "My room", "a name the student gives is kept");

  const empty = await saveLocation(student, { label: "Nowhere", address: "   " });
  assert.equal(empty.status, 400);
  assert.match(String(empty.json.error), /delivery address/i, "the written location stays required");
});

test("only signed-in students save locations, and coordinates are validated", { skip }, async () => {
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  const student = await createTestUser("STUDENT");
  assert.equal((await saveLocation(null, { address: "Gate" })).status, 401);
  assert.equal((await saveLocation(runner, { address: "Gate" })).status, 403);
  assert.equal((await saveLocation(student, { address: "Gate", latitude: 0, longitude: 0 })).status, 400);
  assert.equal((await saveLocation(student, { address: "Gate", latitude: 6.8 })).status, 400);
});

test("the chosen location, pin and instructions are attached to the order; last-used is preselected next time", { skip }, async () => {
  const { db, payments, choice } = app;
  const student = await createTestUser("STUDENT");
  const other = await createTestUser("STUDENT");
  const first = locationOf(await saveLocation(student, { address: "Test Hall C, Room 9", instructions: "Call me" }));
  const second = locationOf(await saveLocation(student, { label: "Faculty", address: "Faculty of Testing, Block 2", latitude: 6.812345, longitude: 3.912345 }));
  const foreign = locationOf(await saveLocation(other, { address: "Someone else's room" }));

  const { products } = await createTestCatalogue([{ name: "Location test item", price: 600 }]);
  signInAs(student);
  assert.equal((await callRoute(app.cart.POST, { method: "POST", body: { productId: products[0].id, quantity: 1 } })).status, 200);
  signInAs(student);
  await assert.rejects(payments.createPaymentAttempt("OPAY", foreign.id, randomUUID()), /saved delivery locations/i, "another student's location can't be used");

  signInAs(student);
  const attempt = await payments.createPaymentAttempt("OPAY", second.id, randomUUID(), "Meet me at the hostel gate");
  const { orderId } = await payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId! }, select: { deliveryLocationId: true, deliveryAddress: true, deliveryInstructions: true } });
  assert.deepEqual(order, { deliveryLocationId: second.id, deliveryAddress: "Faculty of Testing, Block 2", deliveryInstructions: "Meet me at the hostel gate" });
  const snapshot = (await db.payment.findUniqueOrThrow({ where: { id: attempt.id }, select: { checkoutSnapshot: true } })).checkoutSnapshot as Record<string, unknown>;
  assert.equal(snapshot.deliveryLocationLabel, "Faculty");
  assert.equal(snapshot.deliveryLatitude, 6.812345, "the runner gets the student's own pin");

  // Next checkout: the last-used location comes first even though another was saved earlier/later.
  const saved = await db.savedLocation.findMany({ where: { userId: student.userId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const lastOrder = await db.order.findFirst({ where: { userId: student.userId, deliveryLocationId: { not: null } }, orderBy: { createdAt: "desc" }, select: { deliveryLocationId: true } });
  assert.equal(choice.orderLocationsForCheckout(saved, lastOrder?.deliveryLocationId)[0].id, second.id);
  assert.ok(saved.some((location) => location.id === first.id));
});
