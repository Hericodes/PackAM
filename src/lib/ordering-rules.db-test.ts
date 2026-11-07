/**
 * Ordering times (Monday–Friday, 8am–5pm campus time) and the OOU main campus delivery area, against a disposable database:
 * - outside hours, no new payment starts (shop/food checkout and printing), the cart and print job are kept,
 *   and an attempt started in time can still be resumed;
 * - a live GPS pin outside campus is never saved, and a saved pin outside campus is never paid for.
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
} from "../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  locations: typeof import("../app/api/locations/route");
  cart: typeof import("../app/api/cart/route");
  paymentCreate: typeof import("../app/api/payments/create/route");
  payments: typeof import("./payments/payment-lifecycle");
  uploads: typeof import("../app/api/print-jobs/uploads/route");
  prepare: typeof import("../app/api/print-jobs/[id]/prepare/route");
  printPayment: typeof import("../app/api/print-jobs/[id]/payment/route");
  printing: typeof import("./printing/service");
  hours: typeof import("./ordering-hours");
  area: typeof import("./service-area");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [locations, cart, paymentCreate, payments, uploads, prepare, printPayment, printing, hours, area] = await Promise.all([
    import("../app/api/locations/route"),
    import("../app/api/cart/route"),
    import("../app/api/payments/create/route"),
    import("./payments/payment-lifecycle"),
    import("../app/api/print-jobs/uploads/route"),
    import("../app/api/print-jobs/[id]/prepare/route"),
    import("../app/api/print-jobs/[id]/payment/route"),
    import("./printing/service"),
    import("./ordering-hours"),
    import("./service-area"),
  ]);
  app = { db, locations, cart, paymentCreate, payments, uploads, prepare, printPayment, printing, hours, area };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;

const onCampus = { latitude: 6.9225, longitude: 3.871801 };
const agoIwoyeTown = { latitude: 6.942359, longitude: 3.921554 };
const printConfiguration = { paperSize: "A4", colorMode: "BLACK_AND_WHITE", sides: "SINGLE", copies: 1, pageSelection: "ALL", instructions: "" };

/** A one-hour window that never contains the current campus time, so "closed" holds whenever the suite runs. */
function windowExcludingNow() {
  const campusMinute = Math.floor((Date.now() / 60_000 + 60) % 1_440);
  const start = campusMinute + 120 <= 1_440 ? campusMinute + 60 : campusMinute - 120;
  const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return `${clock(start)}-${clock(start + 60)}`;
}

async function whileClosed<T>(work: () => Promise<T>) {
  const previous = process.env.ORDERING_HOURS;
  process.env.ORDERING_HOURS = windowExcludingNow();
  try {
    return await work();
  } finally {
    process.env.ORDERING_HOURS = previous;
  }
}

async function studentWithCartItem(price = 700) {
  const student = await createTestUser("STUDENT");
  const { products } = await createTestCatalogue([{ name: "Ordering rules item", price }]);
  signInAs(student);
  const added = await callRoute(app.cart.POST, { method: "POST", body: { productId: products[0].id, quantity: 1 } });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  return student;
}

function payByRoute(student: User, deliveryLocationId: string, key = randomUUID()) {
  signInAs(student);
  return callRoute(app.paymentCreate.POST, { method: "POST", path: "/api/payments/create", headers: { "Idempotency-Key": key }, body: { deliveryLocationId, reviewedTotal: 0 } });
}

async function draftPrintJob(student: User) {
  signInAs(student);
  const draft = await callRoute(app.uploads.POST, { method: "POST" });
  assert.equal(draft.status, 201, JSON.stringify(draft.json?.error));
  const printJobId = draft.json.printJobId as string;
  await app.db.printDocument.create({
    data: { printJobId, uploadedById: student.userId, publicId: `packam/print-jobs/${printJobId}.pdf`, originalFileName: "synthetic-hours-test.pdf", mimeType: "application/pdf", fileSize: 24_000, pageCount: 3 },
  });
  return printJobId;
}

function preparePrint(student: User, printJobId: string, deliveryLocationId: string) {
  signInAs(student);
  return callRoute(app.prepare.POST, { method: "POST", params: { id: printJobId }, body: { configuration: printConfiguration, deliveryLocationId } });
}

test("checkout is refused outside ordering hours; nothing is created and the cart is kept", { skip }, async () => {
  const student = await studentWithCartItem();
  const location = await createTestLocation(student.userId);

  const refused = await whileClosed(() => payByRoute(student, location.id));
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(refused.json.code, "ORDERING_CLOSED");
  assert.match(String(refused.json.error), /takes orders .*opens again/);
  assert.match(String(refused.json.error), /cart is saved, and nothing has been charged/);
  assert.equal(await app.db.payment.count({ where: { userId: student.userId } }), 0, "no payment attempt was created");
  assert.equal(await app.db.cartItem.count({ where: { cart: { userId: student.userId } } }), 1, "the cart is untouched");

  signInAs(student);
  await whileClosed(() => assert.rejects(app.payments.createPaymentAttempt("OPAY", location.id, randomUUID()), app.hours.OrderingClosedError));
});

test("an attempt started before closing time can still be resumed after it", { skip }, async () => {
  const student = await studentWithCartItem();
  const location = await createTestLocation(student.userId);
  const key = randomUUID();
  signInAs(student);
  const started = await app.payments.createPaymentAttempt("OPAY", location.id, key);

  signInAs(student);
  const resumed = await whileClosed(() => app.payments.createPaymentAttempt("OPAY", location.id, key));
  assert.equal(resumed.id, started.id, "the same attempt, so the student can finish paying");
  signInAs(student);
  await whileClosed(() => assert.rejects(app.payments.createPaymentAttempt("OPAY", location.id, randomUUID()), app.hours.OrderingClosedError, "but no new one"));
});

test("printing follows the same hours: settings can't be confirmed and no payment starts while closed", { skip }, async () => {
  const student = await createTestUser("STUDENT");
  const location = await createTestLocation(student.userId);
  const printJobId = await draftPrintJob(student);

  const closedPrepare = await whileClosed(() => preparePrint(student, printJobId, location.id));
  assert.equal(closedPrepare.status, 409, JSON.stringify(closedPrepare.json));
  assert.equal(closedPrepare.json.code, "ORDERING_CLOSED");
  assert.match(String(closedPrepare.json.error), /print job is saved/);

  const prepared = await preparePrint(student, printJobId, location.id);
  assert.equal(prepared.status, 200, JSON.stringify(prepared.json?.error));

  signInAs(student);
  const closedPayment = await whileClosed(() => callRoute(app.printPayment.POST, { method: "POST", params: { id: printJobId }, headers: { "Idempotency-Key": randomUUID() } }));
  assert.equal(closedPayment.status, 409, JSON.stringify(closedPayment.json));
  assert.equal(closedPayment.json.code, "ORDERING_CLOSED");
  assert.equal(await app.db.payment.count({ where: { printJobId } }), 0, "no print payment attempt was created");
  await whileClosed(() => assert.rejects(app.printing.createPrintPaymentAttempt("OPAY", student.userId, printJobId, randomUUID()), app.hours.OrderingClosedError));
});

test("a live pin outside OOU main campus is refused; one on campus is saved", { skip }, async () => {
  const student = await createTestUser("STUDENT");
  signInAs(student);
  const outside = await callRoute(app.locations.POST, { method: "POST", body: { address: "Hostel in town", ...agoIwoyeTown } });
  assert.equal(outside.status, 400, JSON.stringify(outside.json));
  assert.equal(outside.json.code, "OUTSIDE_SERVICE_AREA");
  assert.match(String(outside.json.error), /outside campus.*OOU main campus/);
  assert.equal(await app.db.savedLocation.count({ where: { userId: student.userId } }), 0, "nothing was saved");

  signInAs(student);
  const inside = await callRoute(app.locations.POST, { method: "POST", body: { address: "Faculty of Science, Block 2", ...onCampus } });
  assert.equal(inside.status, 201, JSON.stringify(inside.json));
});

test("a saved pin outside campus (saved before the rule) is never paid for", { skip }, async () => {
  const student = await studentWithCartItem();
  const offCampus = await app.db.savedLocation.create({ data: { userId: student.userId, label: "Old hostel", address: "Town hostel", ...agoIwoyeTown }, select: { id: true } });

  signInAs(student);
  await assert.rejects(app.payments.createPaymentAttempt("OPAY", offCampus.id, randomUUID()), app.area.OutsideServiceAreaError);
  const refused = await payByRoute(student, offCampus.id);
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(refused.json.code, "OUTSIDE_SERVICE_AREA");
  assert.equal(await app.db.payment.count({ where: { userId: student.userId } }), 0);

  const printJobId = await draftPrintJob(student);
  const printRefused = await preparePrint(student, printJobId, offCampus.id);
  assert.equal(printRefused.status, 400, JSON.stringify(printRefused.json));
  assert.equal(printRefused.json.code, "OUTSIDE_SERVICE_AREA");
});
