import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CHECKOUT_DELIVERY_FEE } from "./checkout-pricing";
import {
  DISPLAY_ORDER, PRIORITY_ORDER, URGENT_TIERS, DELIVERY_TIER_LABELS, DELIVERY_TIER_DESCRIPTIONS, ESCALATION_MINUTES,
  HOLDS_URGENT_MISSION_MESSAGE, URGENT_NEEDS_IDLE_RUNNER_MESSAGE, STANDARD_DELIVERY_LABEL, URGENT_ESCALATION_TITLE, urgentEscalationMessage,
  checkoutDeliveryFee, compareMissionPriority, decideTierAcceptance, deliveryDueAt, deliveryPriceSummary, deliveryTierTone, describeOrderDelivery,
  fallbackQuoteSet, formatCampusClock, formatEta, idleRunnerRuleApplies, isValidTierFee, parseCheckoutDeliveryRequest, parseDeliveryTier,
  parseSnapshotDeliveryTier, quoteFor, quotesFromRows, snapshotDeliveryTierFields, snapshotTierForReuse, tierRank, urgentEscalationDue,
  urgentSafeDeadlineMinutes, type DeliveryTierSettingRow,
} from "./delivery-tiers";

/** The rows migration 20261101150000 seeds: the owner-approved configuration. */
const APPROVED: DeliveryTierSettingRow[] = [
  { tier: "CRUISE", fee: 200, enabled: true, etaMinMinutes: 20, etaMaxMinutes: 30, version: 1 },
  { tier: "SHARP", fee: 300, enabled: true, etaMinMinutes: 15, etaMaxMinutes: 25, version: 1 },
  { tier: "OYA", fee: 400, enabled: true, etaMinMinutes: 10, etaMaxMinutes: 15, version: 1 },
];
const at = (iso: string) => new Date(iso);
const minutesAfter = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

test("the approved configuration: three tiers on, with the approved prices, windows, labels and descriptions", () => {
  const set = quotesFromRows(APPROVED);
  assert.equal(set.source, "settings");
  assert.deepEqual(set.quotes.map((q) => [q.tier, q.label, q.fee, formatEta(q.etaMinMinutes, q.etaMaxMinutes), q.available]), [
    ["CRUISE", "Cruise Mode", 200, "20–30 minutes", true],
    ["SHARP", "Sharp Sharp", 300, "15–25 minutes", true],
    ["OYA", "Oya Now!", 400, "10–15 minutes", true],
  ]);
  assert.equal(DELIVERY_TIER_DESCRIPTIONS.CRUISE, "No rush, we’re coming. Your order joins the next delivery batch.");
  assert.equal(DELIVERY_TIER_DESCRIPTIONS.SHARP, "Need it a little quicker? We’ve got you.");
  assert.equal(DELIVERY_TIER_DESCRIPTIONS.OYA, "When you need it ASAP. Your order gets top delivery priority.");
  assert.deepEqual(DELIVERY_TIER_LABELS, { CRUISE: "Cruise Mode", SHARP: "Sharp Sharp", OYA: "Oya Now!" });
});

test("display order is the approved table's; priority runs Oya Now!, Sharp Sharp, Cruise Mode", () => {
  assert.deepEqual(DISPLAY_ORDER, ["CRUISE", "SHARP", "OYA"]);
  assert.deepEqual(PRIORITY_ORDER, ["OYA", "SHARP", "CRUISE"]);
  assert.deepEqual(URGENT_TIERS, ["OYA", "SHARP"]);
  assert.deepEqual(ESCALATION_MINUTES, { OYA: 5, SHARP: 10 });
  assert.ok(tierRank("OYA") < tierRank("SHARP") && tierRank("SHARP") < tierRank("CRUISE"));
  assert.equal(tierRank(null), tierRank("CRUISE"), "orders without a tier rank with Cruise Mode");
  assert.equal(tierRank(undefined), tierRank("CRUISE"), "print missions rank with Cruise Mode");
});

test("without the settings table (or with no rows): Cruise Mode only, at the existing fee, 20–30 minutes", () => {
  for (const set of [fallbackQuoteSet(), quotesFromRows(null), quotesFromRows([])]) {
    assert.equal(set.source, "fallback");
    assert.deepEqual(set.quotes.map((q) => [q.tier, q.available]), [["CRUISE", true], ["SHARP", false], ["OYA", false]]);
    const cruise = quoteFor(set, "CRUISE");
    assert.deepEqual([cruise.fee, cruise.etaMinMinutes, cruise.etaMaxMinutes, cruise.settingsVersion], [CHECKOUT_DELIVERY_FEE, 20, 30, null]);
    assert.equal(CHECKOUT_DELIVERY_FEE, 200);
  }
});

test("a tier is for sale only when on, priced (whole naira ≥ ₦1) and with a sane window; others are never touched", () => {
  const variants: Array<[Partial<DeliveryTierSettingRow>, boolean]> = [
    [{ enabled: false }, false], [{ fee: null }, false], [{ fee: 0 }, false], [{ fee: -300 }, false], [{ fee: 12.5 }, false],
    [{ fee: 100_001 }, false], [{ etaMinMinutes: 0 }, false], [{ etaMinMinutes: 30, etaMaxMinutes: 20 }, false], [{ etaMaxMinutes: 1441 }, false], [{}, true],
  ];
  for (const [change, available] of variants) {
    const set = quotesFromRows(APPROVED.map((row) => row.tier === "SHARP" ? { ...row, ...change } : row));
    assert.equal(quoteFor(set, "SHARP").available, available, JSON.stringify(change));
    assert.equal(quoteFor(set, "CRUISE").available, true);
    assert.equal(quoteFor(set, "OYA").fee, 400);
  }
  const missingRow = quotesFromRows(APPROVED.filter((row) => row.tier !== "OYA"));
  assert.equal(missingRow.source, "settings");
  assert.equal(quoteFor(missingRow, "OYA").available, false, "a missing row is unavailable, not the fallback");
  assert.equal(isValidTierFee(1), true);
  assert.equal(isValidTierFee("400"), false);
});

test("tier codes are exact: no lowercase, no prototype keys, no numbers", () => {
  for (const code of ["CRUISE", "SHARP", "OYA"]) assert.equal(parseDeliveryTier(code), code);
  for (const bad of ["cruise", "Oya", "", " OYA", "TURBO", "__proto__", "constructor", "toString", null, undefined, 1, {}, ["OYA"]]) {
    assert.equal(parseDeliveryTier(bad), null, String(bad));
  }
});

test("the payment request: no tier means Cruise Mode (old tabs); a bad tier or fee is refused, never mapped", () => {
  assert.deepEqual(parseCheckoutDeliveryRequest({ reviewedTotal: 1200 }), { ok: true, tier: undefined, reviewedDeliveryFee: undefined });
  assert.deepEqual(parseCheckoutDeliveryRequest({ deliveryTier: "SHARP", reviewedDeliveryFee: 300 }), { ok: true, tier: "SHARP", reviewedDeliveryFee: 300 });
  for (const tier of ["oya", null, "", 3, "TURBO", "__proto__"]) {
    const parsed = parseCheckoutDeliveryRequest({ deliveryTier: tier, reviewedDeliveryFee: 300 });
    assert.equal(parsed.ok, false, String(tier));
    assert.equal(!parsed.ok && parsed.code, "INVALID_DELIVERY_TIER");
  }
  const feeWithoutTier = parseCheckoutDeliveryRequest({ reviewedDeliveryFee: 200 });
  assert.equal(!feeWithoutTier.ok && feeWithoutTier.code, "INVALID_DELIVERY_TIER", "a fee without a tier never falls back to Cruise");
  for (const fee of [-1, 1.5, "300", null, Number.MAX_SAFE_INTEGER + 1]) {
    const parsed = parseCheckoutDeliveryRequest({ deliveryTier: "OYA", reviewedDeliveryFee: fee });
    assert.equal(!parsed.ok && parsed.code, "INVALID_REVIEWED_DELIVERY_FEE", String(fee));
  }
  assert.deepEqual(parseCheckoutDeliveryRequest(null), { ok: true, tier: undefined, reviewedDeliveryFee: undefined });
});

test("checkout totals: subtotal plus the chosen speed's fee; nothing for an empty cart or an unavailable speed", () => {
  const set = quotesFromRows(APPROVED);
  const subtotal = 2 * 1500;
  assert.equal(subtotal + checkoutDeliveryFee(quoteFor(set, "CRUISE"), 2), 3200);
  assert.equal(subtotal + checkoutDeliveryFee(quoteFor(set, "SHARP"), 2), 3300);
  assert.equal(subtotal + checkoutDeliveryFee(quoteFor(set, "OYA"), 2), 3400);
  assert.equal(checkoutDeliveryFee(quoteFor(set, "OYA"), 0), 0);
  assert.equal(checkoutDeliveryFee(quoteFor(fallbackQuoteSet(), "OYA"), 2), 0);
  assert.equal(checkoutDeliveryFee(undefined, 2), 0);
  assert.deepEqual(deliveryPriceSummary(set.quotes), { fromFee: 200, options: 3 });
  assert.deepEqual(deliveryPriceSummary(fallbackQuoteSet().quotes), { fromFee: 200, options: 1 });
  assert.equal(deliveryPriceSummary(quotesFromRows(APPROVED.map((row) => ({ ...row, enabled: false }))).quotes), null);
});

test("snapshot fields round-trip; old snapshots are legacy; damaged ones are flagged, never guessed", () => {
  const sharp = quoteFor(quotesFromRows(APPROVED.map((row) => ({ ...row, version: 4 }))), "SHARP");
  const fields = snapshotDeliveryTierFields(sharp);
  assert.deepEqual(fields, { deliveryTier: "SHARP", deliveryEtaMinMinutes: 15, deliveryEtaMaxMinutes: 25, deliveryTierSettingsVersion: 4 });
  const base = { cartId: "c", items: [], subtotal: 1000, deliveryFee: 300 };
  assert.deepEqual(parseSnapshotDeliveryTier({ ...base, ...fields }), { kind: "tier", tier: "SHARP", etaMinMinutes: 15, etaMaxMinutes: 25, settingsVersion: 4 });
  const fallback = snapshotDeliveryTierFields(quoteFor(fallbackQuoteSet(), "CRUISE"));
  assert.deepEqual(parseSnapshotDeliveryTier({ ...base, ...fallback }), { kind: "tier", tier: "CRUISE", etaMinMinutes: 20, etaMaxMinutes: 30, settingsVersion: null });
  assert.deepEqual(parseSnapshotDeliveryTier(base), { kind: "legacy" });
  assert.deepEqual(parseSnapshotDeliveryTier(null), { kind: "legacy" });
  for (const damage of [{ deliveryTier: "oya" }, { deliveryEtaMinMinutes: 0 }, { deliveryEtaMaxMinutes: "25" }, { deliveryTierSettingsVersion: 0 }, { deliveryTierSettingsVersion: "4" }]) {
    assert.deepEqual(parseSnapshotDeliveryTier({ ...base, ...fields, ...damage }), { kind: "invalid" }, JSON.stringify(damage));
  }
  assert.equal(snapshotTierForReuse(base), "CRUISE", "an attempt from before tiers was a Cruise checkout");
  assert.equal(snapshotTierForReuse({ ...base, ...fields }), "SHARP");
  assert.equal(snapshotTierForReuse({ ...base, ...fields, deliveryTier: "TURBO" }), null);
});

test("due time and display: the order's own frozen window; no row is Standard delivery", () => {
  const confirmed = at("2026-11-02T14:20:00.000Z");
  const dueAt = deliveryDueAt(confirmed, 25);
  assert.equal(dueAt.toISOString(), "2026-11-02T14:45:00.000Z");
  assert.equal(formatCampusClock(dueAt), "15:45", "Lagos is UTC+1");
  const shown = describeOrderDelivery({ tier: "SHARP", etaMinMinutes: 15, etaMaxMinutes: 25, dueAt });
  assert.deepEqual([shown.kind, shown.label, shown.eta, shown.etaShort, shown.urgent], ["tier", "Sharp Sharp", "15–25 minutes", "15–25 min", true]);
  assert.deepEqual(describeOrderDelivery({ tier: "CRUISE", etaMinMinutes: 20, etaMaxMinutes: 30, dueAt: dueAt.toISOString() }).urgent, false);
  for (const missing of [null, undefined, { tier: "TURBO", etaMinMinutes: 1, etaMaxMinutes: 2, dueAt }]) {
    const standard = describeOrderDelivery(missing);
    assert.deepEqual([standard.kind, standard.label, standard.eta, standard.dueAt], ["standard", STANDARD_DELIVERY_LABEL, null, null]);
  }
  assert.equal(STANDARD_DELIVERY_LABEL, "Standard delivery");
});

test("idle-runner rule: urgent tiers only, until escalated or the threshold passes", () => {
  const start = at("2026-11-02T10:00:00.000Z");
  assert.equal(idleRunnerRuleApplies({ tier: "OYA", startedAt: start, escalatedAt: null, now: minutesAfter(start, 4.99) }), true);
  assert.equal(idleRunnerRuleApplies({ tier: "OYA", startedAt: start, escalatedAt: null, now: minutesAfter(start, 5) }), false);
  assert.equal(idleRunnerRuleApplies({ tier: "SHARP", startedAt: start, escalatedAt: null, now: minutesAfter(start, 9.99) }), true);
  assert.equal(idleRunnerRuleApplies({ tier: "SHARP", startedAt: start, escalatedAt: null, now: minutesAfter(start, 10) }), false);
  assert.equal(idleRunnerRuleApplies({ tier: "OYA", startedAt: start, escalatedAt: minutesAfter(start, 1), now: minutesAfter(start, 2) }), false, "lifted once escalated");
  for (const tier of ["CRUISE", null, undefined]) assert.equal(idleRunnerRuleApplies({ tier, startedAt: start, escalatedAt: null, now: start }), false);
});

test("escalation is due once: urgent, still waiting, past its threshold, not yet escalated", () => {
  const start = at("2026-11-02T10:00:00.000Z");
  const waiting = { startedAt: start, escalatedAt: null, status: "FINDING_RUNNER", assignedRunnerId: null };
  assert.equal(urgentEscalationDue({ ...waiting, tier: "OYA", now: minutesAfter(start, 4.99) }), false);
  assert.equal(urgentEscalationDue({ ...waiting, tier: "OYA", now: minutesAfter(start, 5) }), true);
  assert.equal(urgentEscalationDue({ ...waiting, tier: "SHARP", now: minutesAfter(start, 6) }), false);
  assert.equal(urgentEscalationDue({ ...waiting, tier: "SHARP", now: minutesAfter(start, 10) }), true);
  assert.equal(urgentEscalationDue({ ...waiting, tier: "OYA", escalatedAt: minutesAfter(start, 5), now: minutesAfter(start, 20) }), false, "never twice");
  assert.equal(urgentEscalationDue({ ...waiting, tier: "OYA", status: "RUNNER_ASSIGNED", now: minutesAfter(start, 20) }), false);
  assert.equal(urgentEscalationDue({ ...waiting, tier: "OYA", assignedRunnerId: "r1", now: minutesAfter(start, 20) }), false);
  for (const tier of ["CRUISE", null]) assert.equal(urgentEscalationDue({ ...waiting, tier, now: minutesAfter(start, 600) }), false);
  assert.equal(urgentSafeDeadlineMinutes("OYA", 1), 5);
  assert.equal(urgentSafeDeadlineMinutes("SHARP", 1), 10);
  assert.equal(urgentSafeDeadlineMinutes("SHARP", 120), 120);
  assert.equal(urgentSafeDeadlineMinutes("CRUISE", 1), 1);
});

test("acceptance: no stacking onto an urgent mission; urgent needs an idle runner until the rule lifts; Cruise batches", () => {
  assert.deepEqual(decideTierAcceptance({ orderTier: "CRUISE", idleRuleActive: false, activeMissions: 3, holdsUrgent: false }), { ok: true });
  assert.deepEqual(decideTierAcceptance({ orderTier: null, idleRuleActive: false, activeMissions: 3, holdsUrgent: false }), { ok: true });
  assert.deepEqual(decideTierAcceptance({ orderTier: "OYA", idleRuleActive: true, activeMissions: 0, holdsUrgent: false }), { ok: true });
  assert.deepEqual(decideTierAcceptance({ orderTier: "OYA", idleRuleActive: true, activeMissions: 1, holdsUrgent: false }), { ok: false, message: URGENT_NEEDS_IDLE_RUNNER_MESSAGE });
  assert.deepEqual(decideTierAcceptance({ orderTier: "SHARP", idleRuleActive: false, activeMissions: 2, holdsUrgent: false }), { ok: true }, "after escalation anyone available");
  for (const orderTier of ["CRUISE", "SHARP", "OYA", null]) {
    assert.deepEqual(decideTierAcceptance({ orderTier, idleRuleActive: false, activeMissions: 1, holdsUrgent: true }), { ok: false, message: HOLDS_URGENT_MISSION_MESSAGE });
  }
  const routeFilter = /mission|order|runner|price|source|available|quantity|sourcing|accepted|active|verified|expired/i;
  for (const message of [HOLDS_URGENT_MISSION_MESSAGE, URGENT_NEEDS_IDLE_RUNNER_MESSAGE]) assert.match(message, routeFilter, "the runner orders route forwards it");
});

test("the migration seeds exactly the approved configuration, additively, with the database rules", () => {
  const sql = readFileSync(new URL("../../prisma/migrations/20261101150000_delivery_tiers/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /CREATE TYPE "DeliveryTier" AS ENUM \('OYA', 'SHARP', 'CRUISE'\);/, "declaration order = dispatch priority");
  for (const [tier, fee, min, max] of [["CRUISE", 200, 20, 30], ["SHARP", 300, 15, 25], ["OYA", 400, 10, 15]] as const) {
    assert.match(sql, new RegExp(`\\('${tier}', ${fee}, true, ${min}, ${max}, 1, `), `${tier} seeded on at ₦${fee}, ${min}–${max} min`);
  }
  for (const check of ["DeliveryTierSetting_enabled_requires_fee_check", "DeliveryTierSetting_fee_check", "DeliveryTierSetting_eta_check", "OrderDeliveryTier_eta_check"]) assert.match(sql, new RegExp(check));
  assert.match(sql, /REFERENCES "Order"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /ALTER TABLE "(Order|Payment|RunnerAssignment|RunnerProfile|PrintJob)"|UPDATE "|DELETE FROM/, "no existing table or row is changed");
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(schema, /enum DeliveryTier \{\n {2}OYA\n {2}SHARP\n {2}CRUISE\n\}/);
});

test("the escalation alert names the speed, the order and the threshold", () => {
  assert.equal(URGENT_ESCALATION_TITLE, "Urgent delivery not accepted");
  assert.equal(urgentEscalationMessage("OYA", "AB12CD34"), "Oya Now! order AB12CD34 wasn’t accepted within 5 minutes. It’s now offered to every available runner. Check that someone picks it up.");
  assert.match(urgentEscalationMessage("SHARP", "X"), /^Sharp Sharp order X wasn’t accepted within 10 minutes\./);
});

test("badge tones: Oya Now! red, Sharp Sharp amber, Cruise Mode blue, no tier neutral", () => {
  assert.deepEqual(["OYA", "SHARP", "CRUISE", null].map(deliveryTierTone), ["danger", "progress", "info", "neutral"]);
});

test("runner lists: priority first, then the longest wait", () => {
  const cards = [
    { id: "cruise-old", rank: tierRank("CRUISE"), waitingSince: 1 },
    { id: "oya-new", rank: tierRank("OYA"), waitingSince: 9 },
    { id: "legacy", rank: tierRank(null), waitingSince: 0 },
    { id: "sharp", rank: tierRank("SHARP"), waitingSince: 5 },
    { id: "oya-old", rank: tierRank("OYA"), waitingSince: 3 },
  ];
  assert.deepEqual([...cards].sort(compareMissionPriority).map((card) => card.id), ["oya-old", "oya-new", "sharp", "legacy", "cruise-old"]);
});
