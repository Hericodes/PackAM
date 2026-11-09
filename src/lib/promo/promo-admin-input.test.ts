import assert from "node:assert/strict";
import { test } from "node:test";
import { adminPromoRow, parseNewPromoCode, parsePromoActiveChange, promoStatus, type AdminPromoSource } from "./promo-admin-input";

const now = new Date("2026-11-10T10:00:00+01:00");
const base = { code: "welcome1k", type: "FIXED", value: "1,000" };

test("a fixed ₦1k code with defaults: any order, one use per student, no total limit, no dates", () => {
  const parsed = parseNewPromoCode(base, now);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && parsed.data, { code: "WELCOME1K", type: "FIXED", value: 1_000, maxDiscount: null, minSubtotal: 0, maxUses: null, maxUsesPerStudent: 1, startsAt: null, endsAt: null });
});

test("a % code with a cap, a minimum, limits and campus-day dates (the end day is included)", () => {
  const parsed = parseNewPromoCode({ code: "TENOFF", type: "PERCENT", value: 10, maxDiscount: "2000", minSubtotal: "5000", maxUses: "100", maxUsesPerStudent: "2", startsOn: "2026-11-12", endsOn: "2026-11-30" }, now);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.maxDiscount, 2_000);
  assert.equal(parsed.data.minSubtotal, 5_000);
  assert.equal(parsed.data.maxUses, 100);
  assert.equal(parsed.data.maxUsesPerStudent, 2);
  assert.equal(parsed.data.startsAt?.toISOString(), new Date("2026-11-12T00:00:00+01:00").toISOString());
  assert.equal(parsed.data.endsAt?.toISOString(), new Date("2026-12-01T00:00:00+01:00").toISOString(), "valid through the whole of 30 Nov");
});

test("bad input is refused with the field to fix", () => {
  const refuse = (body: Record<string, unknown>) => {
    const parsed = parseNewPromoCode(body, now);
    assert.equal(parsed.ok, false, JSON.stringify(body));
    return parsed.ok ? null : parsed.field;
  };
  assert.equal(refuse({ ...base, code: "NO-DASHES" }), "code");
  assert.equal(refuse({ ...base, code: "AB" }), "code");
  assert.equal(refuse({ ...base, type: "BOGOF" }), "type");
  assert.equal(refuse({ ...base, value: 0 }), "value");
  assert.equal(refuse({ ...base, value: "1000.50" }), "value");
  assert.equal(refuse({ ...base, value: "" }), "value");
  assert.equal(refuse({ code: "PCT", type: "PERCENT", value: 101 }), "value");
  assert.equal(refuse({ ...base, maxDiscount: 500 }), "maxDiscount", "a cap only makes sense on % codes");
  assert.equal(refuse({ ...base, minSubtotal: -1 }), "minSubtotal");
  assert.equal(refuse({ ...base, maxUses: 0 }), "maxUses");
  assert.equal(refuse({ ...base, maxUsesPerStudent: 0 }), "maxUsesPerStudent");
  assert.equal(refuse({ ...base, maxUsesPerStudent: 101 }), "maxUsesPerStudent");
  assert.equal(refuse({ ...base, startsOn: "2026-02-30" }), "startsOn");
  assert.equal(refuse({ ...base, endsOn: "30/11/2026" }), "endsOn");
  assert.equal(refuse({ ...base, startsOn: "2026-11-20", endsOn: "2026-11-19" }), "endsOn");
  assert.equal(refuse({ ...base, endsOn: "2026-11-09" }), "endsOn", "already over");
  assert.equal(parseNewPromoCode({ ...base, startsOn: "2026-11-20", endsOn: "2026-11-20" }, now).ok, true, "a one-day code");
  assert.equal(parseNewPromoCode(null).ok, false);
});

test("pausing takes an explicit true or false", () => {
  assert.deepEqual(parsePromoActiveChange({ active: false }), { ok: true, data: { active: false } });
  assert.equal(parsePromoActiveChange({ active: "false" }).ok, false);
  assert.equal(parsePromoActiveChange({}).ok, false);
});

const source: AdminPromoSource = { id: "p1", code: "WELCOME1K", type: "FIXED", value: 1_000, maxDiscount: null, minSubtotal: 0, maxUses: 100, maxUsesPerStudent: 1, startsAt: null, endsAt: new Date("2026-12-01T00:00:00+01:00"), active: true, createdAt: new Date("2026-11-09T09:00:00+01:00"), createdByName: "Ade", uses: 12, discountGiven: 12_000 };

test("status follows pause, dates and the total limit", () => {
  assert.equal(promoStatus(source, now), "LIVE");
  assert.equal(promoStatus({ ...source, active: false }, now), "PAUSED");
  assert.equal(promoStatus({ ...source, startsAt: new Date("2026-11-12T00:00:00+01:00") }, now), "SCHEDULED");
  assert.equal(promoStatus(source, new Date("2026-12-01T00:00:00+01:00")), "EXPIRED");
  assert.equal(promoStatus({ ...source, uses: 100 }, now), "USED_UP");
});

test("list rows read plainly", () => {
  const row = adminPromoRow(source, now);
  assert.equal(row.offer, "₦1,000 off your items");
  assert.equal(row.conditions, "Any order · 1 use per student · 100 uses in total");
  assert.equal(row.window, "Until 30 Nov 2026", "the exclusive end shows as the last whole day");
  assert.equal(row.usage, "12 of 100 used · ₦12,000 given");
  assert.equal(row.createdLabel, "Created 9 Nov 2026 by Ade");
  assert.equal(adminPromoRow({ ...source, maxUses: null, endsAt: null, minSubtotal: 5_000, maxUsesPerStudent: 3 }, now).conditions, "Items from ₦5,000 · 3 uses per student · No total limit");
  assert.equal(adminPromoRow({ ...source, endsAt: null }, now).window, "No end date");
});
