import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PromoCodeRejectedError,
  describePromo,
  normalizePromoCode,
  promoDiscount,
  promoFromSnapshot,
  promoRefusal,
  snapshotHasPromo,
  snapshotPromoCode,
  type PromoCodeState,
} from "./promo-rules";

const fixed1k: PromoCodeState = { id: "p1", code: "WELCOME1K", type: "FIXED", value: 1_000, maxDiscount: null, minSubtotal: 0, active: true, startsAt: null, endsAt: null, maxUses: null, maxUsesPerStudent: 1 };
const tenPercent: PromoCodeState = { ...fixed1k, id: "p2", code: "TENOFF", type: "PERCENT", value: 10, maxDiscount: 2_000 };
const now = new Date("2026-11-10T10:00:00+01:00");
const fresh = { now, subtotal: 5_000, usesTotal: 0, usesByStudent: 0 };

test("codes are matched case-insensitively, without spaces; anything else is invalid", () => {
  assert.equal(normalizePromoCode(" welcome1k "), "WELCOME1K");
  assert.equal(normalizePromoCode("Welcome 1K"), "WELCOME1K");
  for (const bad of ["", "AB", "THIS-CODE", "CODE!", "A".repeat(21), 123, null, undefined]) assert.equal(normalizePromoCode(bad), null, String(bad));
});

test("a fixed code takes its amount off the items, never more than the items cost", () => {
  assert.equal(promoDiscount(fixed1k, 5_000), 1_000);
  assert.equal(promoDiscount({ ...fixed1k, value: 2_000 }, 1_500), 1_500, "₦2k code on ₦1,500 of items: ₦1,500 off, delivery still paid");
  assert.equal(promoDiscount(fixed1k, 0), 0);
});

test("a percentage code rounds down and respects its cap", () => {
  assert.equal(promoDiscount(tenPercent, 5_000), 500);
  assert.equal(promoDiscount(tenPercent, 1_234), 123, "₦123.40 rounds down to ₦123");
  assert.equal(promoDiscount(tenPercent, 50_000), 2_000, "10% of ₦50,000 is ₦5,000, capped at ₦2,000");
  assert.equal(promoDiscount({ ...tenPercent, maxDiscount: null }, 50_000), 5_000, "no cap");
  assert.equal(promoDiscount({ ...tenPercent, value: 100, maxDiscount: null }, 3_000), 3_000, "100% off the items");
  assert.equal(promoDiscount(tenPercent, 9), 0, "10% of ₦9 rounds to nothing");
});

test("below the minimum there is no discount", () => {
  const min5k = { ...fixed1k, minSubtotal: 5_000 };
  assert.equal(promoDiscount(min5k, 4_999), 0);
  assert.equal(promoDiscount(min5k, 5_000), 1_000);
});

test("a usable code is refused for nothing", () => {
  assert.equal(promoRefusal(fixed1k, fresh), null);
});

test("each refusal says why, in words a student can act on", () => {
  const refuse = (code: PromoCodeState | null, context = fresh) => promoRefusal(code, context);
  assert.equal(refuse(null)?.reason, "NOT_FOUND");
  assert.equal(refuse({ ...fixed1k, active: false })?.reason, "PAUSED");
  const notYet = refuse({ ...fixed1k, startsAt: new Date("2026-12-01T00:00:00+01:00") });
  assert.equal(notYet?.reason, "NOT_STARTED");
  assert.match(notYet!.message, /starts on 1 Dec 2026/);
  assert.equal(refuse({ ...fixed1k, endsAt: now })?.reason, "EXPIRED", "the end is exclusive");
  assert.equal(refuse({ ...fixed1k, endsAt: new Date(now.getTime() + 1) }), null);
  assert.equal(refuse({ ...fixed1k, maxUses: 100 }, { ...fresh, usesTotal: 100 })?.reason, "USED_UP");
  assert.equal(refuse({ ...fixed1k, maxUses: 100 }, { ...fresh, usesTotal: 99 }), null);
  assert.equal(refuse(fixed1k, { ...fresh, usesByStudent: 1 })?.message, "You’ve already used this promo code.");
  assert.match(refuse({ ...fixed1k, maxUsesPerStudent: 3 }, { ...fresh, usesByStudent: 3 })!.message, /3 times, the most allowed/);
  assert.equal(refuse({ ...fixed1k, maxUsesPerStudent: 3 }, { ...fresh, usesByStudent: 2 }), null);
  const short = refuse({ ...fixed1k, minSubtotal: 6_000 });
  assert.equal(short?.reason, "MIN_SUBTOTAL");
  assert.equal(short?.message, "This code needs items worth at least ₦6,000. Add ₦1,000 more to use it.");
  assert.equal(refuse(tenPercent, { ...fresh, subtotal: 5 })?.reason, "NOTHING_OFF");
  assert.ok(new PromoCodeRejectedError("PAUSED", "x") instanceof Error);
});

test("labels read the way the code works", () => {
  assert.equal(describePromo(fixed1k), "₦1,000 off your items");
  assert.equal(describePromo(tenPercent), "10% off your items (up to ₦2,000)");
  assert.equal(describePromo({ ...tenPercent, maxDiscount: null }), "10% off your items");
});

test("the promo frozen in a snapshot is read strictly", () => {
  const snapshot = { subtotal: 5_000, promo: { promoCodeId: "p1", code: "WELCOME1K", discount: 1_000 } };
  assert.deepEqual(promoFromSnapshot(snapshot), { promoCodeId: "p1", code: "WELCOME1K", discount: 1_000 });
  assert.equal(snapshotPromoCode(snapshot), "WELCOME1K");
  assert.equal(snapshotHasPromo(snapshot), true);
  assert.equal(promoFromSnapshot({ subtotal: 5_000 }), null, "no promo");
  assert.equal(snapshotHasPromo({ subtotal: 5_000 }), false);
  assert.equal(snapshotPromoCode(null), null);
  for (const promo of [{ promoCodeId: "p1", code: "WELCOME1K", discount: 6_000 }, { promoCodeId: "p1", code: "WELCOME1K", discount: 0 }, { promoCodeId: "p1", code: "welcome1k", discount: 100 }, { promoCodeId: "", code: "WELCOME1K", discount: 100 }, { promoCodeId: "p1", code: "WELCOME1K", discount: 1.5 }, "WELCOME1K"]) {
    assert.equal(promoFromSnapshot({ subtotal: 5_000, promo }), null, JSON.stringify(promo));
    assert.equal(snapshotHasPromo({ subtotal: 5_000, promo }), true, "present but invalid: money code must refuse it");
  }
});
