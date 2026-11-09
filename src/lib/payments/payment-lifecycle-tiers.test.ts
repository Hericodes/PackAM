/**
 * Delivery tiers in the payment lifecycle, checked on the source: payment-lifecycle.ts is server-only and imports the
 * database, so unit tests can't load it. The behaviour itself is covered by delivery-tier-checkout.db-test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const lifecycle = source("./payment-lifecycle.ts");

/** The text of one top-level function: from its declaration to the next top-level declaration. */
function slice(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} not found`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to > from, `${end} not found after ${start}`);
  return text.slice(from, to);
}

test("checkout prices the chosen speed inside its retried serializable transaction, on its own, before anything is created", () => {
  const create = slice(lifecycle, "export async function createPaymentAttempt", "\nfunction parseSnapshot");
  assert.match(create, /return await retrySerializable\(\(\) => db\.\$transaction\(async \(tx\) => \{/, "the payment transaction is retried on serialization conflicts (S10)");
  assert.match(create, /\{ isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable \}\), \{ attempts: 4, baseDelayMs: 25 \}\)/);

  const read = create.indexOf("readDeliveryTierQuotesInTransaction(tx)");
  assert.ok(read > 0, "the price is read through the store's savepoint helper, with the transaction client");
  assert.equal(create.split("readDeliveryTierQuotesInTransaction(").length, 2, "read exactly once");
  const promiseAll = create.indexOf("Promise.all([");
  const promiseAllEnd = create.indexOf("]);", promiseAll);
  assert.ok(promiseAll > 0 && promiseAllEnd > promiseAll && read > promiseAllEnd, "never inside the Promise.all on the same transaction");
  assert.ok(read > create.indexOf("throw new CartNotPayableError"), "a cart problem is reported first");
  assert.ok(read < create.indexOf("tx.payment.create"), "an unavailable speed creates nothing");
  assert.ok(create.indexOf("throw new DeliveryTierUnavailableError") > read);
  assert.ok(create.indexOf("const existing = await tx.payment.findUnique") < read, "an existing attempt is resumed before any pricing");

  // The fee charged is the server's, compared with what the student reviewed, and frozen into the snapshot.
  assert.match(create, /reviewedDeliveryFee !== undefined && reviewedDeliveryFee !== deliveryFee/, "PRICE_CHANGED also compares the fee");
  assert.match(create, /\.\.\.snapshotDeliveryTierFields\(quote\)/);
  assert.doesNotMatch(create, /cart\.deliveryFee|CHECKOUT_DELIVERY_FEE/, "no flat fee anywhere in checkout");
  // A reused idempotency key must be for the same speed and promo code, on both reads of an existing attempt.
  assert.equal(create.split("return resumable(existing, tier, promoCode)").length, 3);

  // A promo code is decided again on the server, in a savepoint on this transaction, after the cart and before the
  // payment row; its use is recorded in the same transaction, right after the payment row exists.
  const promo = create.indexOf("await resolveCheckoutPromo(tx, promoCode, student.id, subtotal)");
  assert.ok(promo > promiseAllEnd && promo > create.indexOf("throw new CartNotPayableError"), "after the cart, never inside the Promise.all");
  assert.ok(promo < create.indexOf("throw new PriceChangedError"), "the discount is part of the total the student reviewed");
  assert.match(create, /const amount = subtotal \+ deliveryFee - discount;/, "the discount comes off the items; delivery is charged in full");
  const recorded = create.indexOf("await recordPromoRedemption(tx, {");
  assert.ok(recorded > create.indexOf("tx.payment.create"), "the use points at the payment just created");
});

test("completing a payment copies the speed from the snapshot only, before the order is offered to runners", () => {
  const complete = slice(lifecycle, "export async function completeVerifiedPayment", "export async function failPendingPayment");
  const record = slice(lifecycle, "async function recordOrderDeliveryTier", "\n}\n");
  for (const [name, text] of [["completeVerifiedPayment", complete], ["recordOrderDeliveryTier", record]] as const) {
    assert.doesNotMatch(text, /readDeliveryTierQuotes|deliveryTierSetting/, `${name} never reads current tier settings`);
  }
  assert.match(record, /parseSnapshotDeliveryTier\(checkoutSnapshot\)/);
  assert.match(record, /writeOrderDeliveryTierInTransaction\(tx, /, "written through the store, in a savepoint, with the transaction client");

  const created = complete.indexOf("tx.order.create");
  const recorded = complete.indexOf("recordOrderDeliveryTier(tx, order.id, attempt.checkoutSnapshot, confirmedAt)");
  assert.ok(created > 0 && recorded > created, "the row is written for the order just created");
  assert.ok(recorded < complete.indexOf("transitionOrderInTransaction(tx"), "before the order starts looking for a runner");
  assert.ok(recorded < complete.indexOf("offerFindingOrderToAvailableRunners(tx"), "before runners are offered the order");
  assert.match(complete, /findingRunnerAt: confirmedAt/, "one clock for dispatch, escalation and the due time");
  // The charged fee and total still come from the snapshot and the attempt, as before tiers.
  assert.match(complete, /deliveryFee: snapshot\.deliveryFee/);
  assert.match(complete, /total: attempt\.amount/);
});

test("the payment route reads only the speed from the body and maps every tier refusal to its own answer", () => {
  const route = source("../../app/api/payments/create/route.ts");
  const parsed = route.indexOf("parseCheckoutDeliveryRequest(body)");
  assert.ok(parsed > route.indexOf("reviewedTotal < 0") && parsed < route.indexOf("await createPaymentAttempt("), "validated after the reviewed total, before anything is created");
  assert.match(route, /\{ tier: delivery\.tier, reviewedDeliveryFee: delivery\.reviewedDeliveryFee \}/);
  assert.doesNotMatch(route, /"(deliveryFee|amount|total)" in body|body as \{ (deliveryFee|amount|total)\b/, "no money field is read from the body");
  for (const code of ["\"DELIVERY_TIER_UNAVAILABLE\"", "\"CHECKOUT_CHANGED\"", "\"PRICE_CHANGED\""]) assert.ok(route.includes(code), code);
  const schema = route.indexOf("if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, \"POST /api/payments/create\")");
  assert.ok(schema > route.indexOf("instanceof CheckoutAttemptMismatchError") && schema < route.indexOf("We couldn't start your payment"), "a schema mismatch answers 503, not a generic 400");
});

test("the cart's price never includes a delivery fee: it depends on the speed chosen at checkout", () => {
  const cartPricing = source("../cart-pricing.ts");
  assert.doesNotMatch(cartPricing, /CHECKOUT_DELIVERY_FEE|deliveryFee|total: subtotal/);
});
