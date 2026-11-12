import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cashbackEarned, cashbackEntryLabel, cashbackFromSnapshot, cashbackToUse, parseCashbackAdjustment, parseCashbackSettingsInput } from "./cashback-rules";
import { creditCashbackOnDelivery, readCashbackBalance, readStudentCashback, resetCashbackProbe } from "./cashback-store";
import { splitOrderDiscount } from "../finance";

afterEach(resetCashbackProbe);

test("earning: a whole % of what was paid for the items, rounded down; nothing when off or on nothing", () => {
  assert.equal(cashbackEarned(2_500, 2), 50);
  assert.equal(cashbackEarned(1_999, 2), 39, "rounded down");
  assert.equal(cashbackEarned(2_500, 0), 0);
  assert.equal(cashbackEarned(0, 5), 0);
  assert.equal(cashbackEarned(-100, 5), 0);
  assert.equal(cashbackEarned(1_000, 80), 500, "never more than 50%");
});

test("spending: as much of the balance as covers the items after the promo code, never delivery", () => {
  assert.equal(cashbackToUse(300, 1_500), 300);
  assert.equal(cashbackToUse(2_000, 1_500), 1_500, "never more than the items");
  assert.equal(cashbackToUse(0, 1_500), 0);
  assert.equal(cashbackToUse(500, 0), 0, "items fully paid by a promo code");
});

test("a payment snapshot's cashback: absent is 0, malformed is refused", () => {
  assert.equal(cashbackFromSnapshot({ items: [] }), 0);
  assert.equal(cashbackFromSnapshot(null), 0);
  assert.equal(cashbackFromSnapshot({ cashback: { amount: 250 } }), 250);
  assert.equal(cashbackFromSnapshot({ cashback: { amount: 0 } }), null);
  assert.equal(cashbackFromSnapshot({ cashback: { amount: "250" } }), null);
  assert.equal(cashbackFromSnapshot({ cashback: 250 }), null);
});

test("order pages split the discount into promo and cashback", () => {
  // Items 2,000 + delivery 200; promo 300 and cashback 250 off, so 1,650 paid.
  assert.deepEqual(splitOrderDiscount({ subtotal: 2_000, deliveryFee: 200, total: 1_650 }, 250), { promo: 300, cashback: 250 });
  assert.deepEqual(splitOrderDiscount({ subtotal: 2_000, deliveryFee: 200, total: 2_200 }, 0), { promo: 0, cashback: 0 });
  assert.deepEqual(splitOrderDiscount({ subtotal: 2_000, deliveryFee: 200, total: 1_950 }, null), { promo: 250, cashback: 0 });
});

test("admin settings and adjustments are checked", () => {
  assert.deepEqual(parseCashbackSettingsInput({ enabled: true, ratePercent: "3", welcomeBonus: "₦1,000" }), { ok: true, data: { enabled: true, ratePercent: 3, welcomeBonus: 1_000 } });
  assert.equal(parseCashbackSettingsInput({ enabled: true, ratePercent: 51, welcomeBonus: 0 }).ok, false);
  assert.equal(parseCashbackSettingsInput({ enabled: true, ratePercent: 2.5, welcomeBonus: 0 }).ok, false, "whole percents only");
  assert.equal(parseCashbackSettingsInput({ enabled: "yes", ratePercent: 2, welcomeBonus: 0 }).ok, false);
  assert.deepEqual(parseCashbackAdjustment({ amount: "-500", note: " Duplicate credit " }), { ok: true, data: { amount: -500, note: "Duplicate credit" } });
  assert.equal(parseCashbackAdjustment({ amount: 0, note: "Nothing" }).ok, false);
  assert.equal(parseCashbackAdjustment({ amount: 500, note: "" }).ok, false, "a reason is required");
  assert.equal(parseCashbackAdjustment({ amount: 1_000_000, note: "Too much" }).ok, false);
  assert.equal(cashbackEntryLabel("ADJUSTMENT", "Sorry your order was late"), "From PackAM: Sorry your order was late");
  assert.equal(cashbackEntryLabel("SPENT", null), "Used at checkout");
});

function client(ready: boolean, overrides: { savepoint?: () => Promise<unknown> } = {}) {
  const calls: string[] = [];
  return {
    calls,
    $queryRaw: async () => { calls.push("probe"); return [{ ready }]; },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      calls.push("savepoint");
      if (overrides.savepoint) return overrides.savepoint();
      return work({});
    },
    cashbackEntry: { findMany: async () => { calls.push("read"); return []; } },
  } as never as { calls: string[] } & Parameters<typeof creditCashbackOnDelivery>[0] & Parameters<typeof readStudentCashback>[0];
}

test("before the cashback migration nothing is read or credited, and a delivery is never affected", async () => {
  const before = client(false);
  assert.deepEqual(await readStudentCashback(before, "u1"), { ready: false });
  assert.equal(await readCashbackBalance(before, "u1"), null);
  assert.equal(await creditCashbackOnDelivery(before, { userId: "u1", source: "order", id: "o1", itemsPaid: 2_000 }), 0);
  assert.deepEqual(before.calls, ["probe", "probe", "probe"], "only the probe ran");
});

test("crediting never fails the delivery, except a serialization conflict the delivery must retry", async () => {
  const broken = client(true, { savepoint: async () => { throw Object.assign(new Error("boom"), { name: "SomethingElse" }); } });
  assert.equal(await creditCashbackOnDelivery(broken, { userId: "u1", source: "order", id: "o1", itemsPaid: 2_000 }), 0, "swallowed");
  resetCashbackProbe();
  const conflict = client(true, { savepoint: async () => { throw Object.assign(new Error("conflict"), { code: "P2034" }); } });
  await assert.rejects(creditCashbackOnDelivery(conflict, { userId: "u1", source: "order", id: "o1", itemsPaid: 2_000 }), /conflict/);
});
