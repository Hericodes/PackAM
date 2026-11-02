import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  adminTierCards, adminTierHistoryEntry, applyTierSettingChange, describeTierChange, isCheckViolation, isWriteConflict, parseTierFeeDraft,
  parseTierSettingChange, tierStateLabel, turnOffConfirmation, type AdminTierRow,
} from "./delivery-tier-admin-input";
import { DELIVERY_TIER_DESCRIPTIONS } from "./delivery-tiers";
import { formatCampusTime } from "./student-copy";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a change names a known tier and the version it was made from; only fee and the switch are read", () => {
  assert.deepEqual(parseTierSettingChange({ tier: "SHARP", version: 3, fee: 350, enabled: true, etaMinMinutes: 1, description: "x", label: "y" }), { ok: true, data: { tier: "SHARP", version: 3, fee: 350, enabled: true } });
  assert.deepEqual(parseTierSettingChange({ tier: "OYA", version: 1, enabled: false }), { ok: true, data: { tier: "OYA", version: 1, enabled: false } });
  assert.deepEqual(parseTierSettingChange({ tier: "OYA", version: 1, fee: null }), { ok: true, data: { tier: "OYA", version: 1, fee: null } });
  for (const [body, field] of [
    [{ tier: "oya", version: 1, fee: 400 }, "tier"], [{ tier: "TURBO", version: 1, fee: 400 }, "tier"], [{ version: 1, fee: 400 }, "tier"],
    [{ tier: "OYA", fee: 400 }, "version"], [{ tier: "OYA", version: 0, fee: 400 }, "version"], [{ tier: "OYA", version: "1", fee: 400 }, "version"],
    [{ tier: "OYA", version: 1, fee: 0 }, "fee"], [{ tier: "OYA", version: 1, fee: -1 }, "fee"], [{ tier: "OYA", version: 1, fee: 12.5 }, "fee"],
    [{ tier: "OYA", version: 1, fee: "400" }, "fee"], [{ tier: "OYA", version: 1, fee: 100_001 }, "fee"], [{ tier: "OYA", version: 1, enabled: "yes" }, "enabled"],
  ] as const) {
    const parsed = parseTierSettingChange(body);
    assert.equal(parsed.ok, false, JSON.stringify(body));
    assert.equal(!parsed.ok && parsed.field, field, JSON.stringify(body));
  }
  assert.equal(parseTierSettingChange({ tier: "OYA", version: 1 }).ok, false, "nothing to change");
  for (const body of [null, [], "x", 1]) assert.equal(parseTierSettingChange(body).ok, false);
});

test("a tier can never be on without a valid fee, checked on the merged row", () => {
  const off = { fee: null, enabled: false };
  assert.deepEqual(applyTierSettingChange(off, { tier: "OYA", version: 1, enabled: true }, [{ fee: 200, enabled: true }]), { ok: false, status: 400, code: "FEE_REQUIRED", error: "Set a fee of at least ₦1 before turning Oya Now! on." });
  assert.deepEqual(applyTierSettingChange(off, { tier: "OYA", version: 1, fee: 450, enabled: true }, []), { ok: true, next: { fee: 450, enabled: true }, changed: true });
  assert.equal(applyTierSettingChange({ fee: 400, enabled: true }, { tier: "OYA", version: 1, fee: null }, [{ fee: 200, enabled: true }]).ok, false, "clearing the fee of a tier that is on");
  assert.deepEqual(applyTierSettingChange({ fee: 400, enabled: true }, { tier: "OYA", version: 1, fee: 450 }, []), { ok: true, next: { fee: 450, enabled: true }, changed: true }, "a fee-only change keeps the switch");
});

test("at least one tier stays on; turning a tier off is fine while another is on", () => {
  const on = { fee: 200, enabled: true };
  assert.deepEqual(applyTierSettingChange(on, { tier: "CRUISE", version: 1, enabled: false }, [{ fee: 300, enabled: false }, { fee: 400, enabled: false }]), { ok: false, status: 409, code: "LAST_ENABLED_TIER", error: "Cruise Mode is the only delivery speed on. Turn another one on first, so students can always check out." });
  assert.deepEqual(applyTierSettingChange(on, { tier: "CRUISE", version: 1, enabled: false }, [{ fee: 300, enabled: true }]), { ok: true, next: { fee: 200, enabled: false }, changed: true });
});

test("an unchanged save is detected (no audit row, no version bump)", () => {
  assert.deepEqual(applyTierSettingChange({ fee: 300, enabled: true }, { tier: "SHARP", version: 2, fee: 300, enabled: true }, []), { ok: true, next: { fee: 300, enabled: true }, changed: false });
});

test("history lines show the previous and new price and status, and never throw on odd rows", () => {
  assert.equal(describeTierChange("SHARP", { fee: 300, enabled: true }, { fee: 350, enabled: false }), "Sharp Sharp: ₦300 → ₦350; on → off");
  assert.equal(describeTierChange("OYA", { fee: null, enabled: false }, { fee: 1500, enabled: true }), "Oya Now!: no fee → ₦1,500; off → on");
  assert.equal(describeTierChange("CRUISE", { fee: 200, enabled: true }, { fee: 200, enabled: true }), "Cruise Mode: no change");
  assert.equal(describeTierChange("CRUISE", null, "x"), "Cruise Mode: changed");
  assert.equal(describeTierChange("WHO", { fee: 1, enabled: true }, { fee: 2, enabled: true }), "WHO: ₦1 → ₦2");
});

const updatedAt = new Date("2026-11-01T14:00:00.000Z");
const APPROVED_ROWS: AdminTierRow[] = [
  { tier: "OYA", fee: 400, enabled: true, etaMinMinutes: 10, etaMaxMinutes: 15, version: 1, updatedAt },
  { tier: "CRUISE", fee: 200, enabled: true, etaMinMinutes: 20, etaMaxMinutes: 30, version: 3, updatedAt },
  { tier: "SHARP", fee: 300, enabled: true, etaMinMinutes: 15, etaMaxMinutes: 25, version: 2, updatedAt },
];

test("the admin cards list Cruise Mode, Sharp Sharp, Oya Now! with fee, window, description, status and version", () => {
  assert.deepEqual(adminTierCards(APPROVED_ROWS), [
    { tier: "CRUISE", label: "Cruise Mode", description: DELIVERY_TIER_DESCRIPTIONS.CRUISE, eta: "20–30 minutes", fee: 200, enabled: true, version: 3, updatedAtLabel: formatCampusTime(updatedAt) },
    { tier: "SHARP", label: "Sharp Sharp", description: DELIVERY_TIER_DESCRIPTIONS.SHARP, eta: "15–25 minutes", fee: 300, enabled: true, version: 2, updatedAtLabel: formatCampusTime(updatedAt) },
    { tier: "OYA", label: "Oya Now!", description: DELIVERY_TIER_DESCRIPTIONS.OYA, eta: "10–15 minutes", fee: 400, enabled: true, version: 1, updatedAtLabel: formatCampusTime(updatedAt) },
  ]);
  const switchedOff = adminTierCards(APPROVED_ROWS.map((row) => row.tier === "OYA" ? { ...row, fee: null, enabled: false } : row));
  assert.deepEqual(switchedOff.map((card) => [card.tier, card.fee, card.enabled]), [["CRUISE", 200, true], ["SHARP", 300, true], ["OYA", null, false]], "the switch and price come from the row");
});

test("before the migration (or with no rows) the cards show what checkout offers then, Cruise Mode only, with nothing to edit", () => {
  for (const rows of [null, []]) {
    const cards = adminTierCards(rows);
    assert.deepEqual(cards.map((card) => [card.tier, card.fee, card.enabled, card.eta, card.version, card.updatedAtLabel]), [
      ["CRUISE", 200, true, "20–30 minutes", null, null],
      ["SHARP", null, false, "15–25 minutes", null, null],
      ["OYA", null, false, "10–15 minutes", null, null],
    ], JSON.stringify(rows));
  }
  const missingOya = adminTierCards(APPROVED_ROWS.filter((row) => row.tier !== "OYA"));
  assert.deepEqual(missingOya.map((card) => [card.tier, card.fee, card.enabled, card.version]), [["CRUISE", 200, true, 3], ["SHARP", 300, true, 2], ["OYA", null, false, null]], "a missing row is off and read-only, never guessed");
});

test("history entries show the summary, previous and new price and status, the admin and the time", () => {
  const createdAt = new Date("2026-11-02T09:30:00.000Z");
  const actor = { firstName: "Ada", lastName: "Obi", email: "ada@packam.test" };
  assert.deepEqual(adminTierHistoryEntry({ id: "a1", resourceId: "SHARP", previousState: { fee: 300, enabled: true }, newState: { fee: 350, enabled: false }, createdAt, actor }), {
    id: "a1", summary: "Sharp Sharp: ₦300 → ₦350; on → off", before: "₦300 · Enabled", after: "₦350 · Disabled", adminName: "Ada Obi", adminEmail: "ada@packam.test", atLabel: formatCampusTime(createdAt),
  });
  const odd = adminTierHistoryEntry({ id: "a2", resourceId: "OYA", previousState: null, newState: { fee: null, enabled: false }, createdAt, actor: { firstName: null, lastName: " ", email: "ops@packam.test" } });
  assert.deepEqual([odd.summary, odd.before, odd.after, odd.adminName], ["Oya Now!: changed", null, "No fee · Disabled", "ops@packam.test"], "an unreadable state never breaks the page; no name falls back to the email");
  assert.equal(tierStateLabel({ fee: 1500, enabled: true }), "₦1,500 · Enabled");
});

test("the card form checks the fee like the API: whole naira from ₦1 to ₦100,000, and a fee before turning a tier on", () => {
  assert.deepEqual(parseTierFeeDraft("350", true, "SHARP"), { ok: true, fee: 350 });
  assert.deepEqual(parseTierFeeDraft(" ₦1,500 ", true, "OYA"), { ok: true, fee: 1500 });
  assert.deepEqual(parseTierFeeDraft("100000", false, "OYA"), { ok: true, fee: 100_000 });
  assert.deepEqual(parseTierFeeDraft("", false, "OYA"), { ok: true, fee: null }, "no fee is allowed while the tier is off");
  assert.deepEqual(parseTierFeeDraft("  ", true, "OYA"), { ok: false, error: "Set a fee before turning Oya Now! on." });
  for (const text of ["0", "100001", "12.5", "-5", "abc", "3e2"]) {
    assert.deepEqual(parseTierFeeDraft(text, false, "CRUISE"), { ok: false, error: "Set the fee in whole naira, from ₦1 to ₦100,000." }, text);
  }
  const serverRule = parseTierSettingChange({ tier: "OYA", version: 1, fee: 0 });
  assert.equal(!serverRule.ok && serverRule.error, "Set the fee in whole naira, from ₦1 to ₦100,000.", "the browser and the server word it the same way");
});

test("turning a tier off asks first; Cruise Mode also warns about checkout pages opened earlier", () => {
  assert.equal(turnOffConfirmation("SHARP"), "Turn off Sharp Sharp? Students won’t be able to choose it at checkout. Orders already paid keep their speed and fee.");
  assert.equal(turnOffConfirmation("CRUISE"), "Turn off Cruise Mode? Students won’t be able to choose it at checkout. Orders already paid keep their speed and fee. Students with an older checkout page open will need to refresh.");
});

test("a database CHECK refusal is recognised from the pg driver adapter's error; other failures are not", () => {
  const constraint = 'new row for relation "DeliveryTierSetting" violates check constraint "DeliveryTierSetting_enabled_requires_fee_check"';
  const adapterError = Object.assign(new Error(`Invalid \`prisma.deliveryTierSetting.update()\` invocation:\n\nDatabase error. Code: \`23514\`. Message: \`${constraint}\``), {
    name: "PrismaClientKnownRequestError",
    code: "P2039",
    meta: { modelName: "DeliveryTierSetting", driverAdapterError: { name: "DriverAdapterError", cause: { originalCode: "23514", originalMessage: constraint, kind: "postgres" } } },
  });
  assert.equal(isCheckViolation(adapterError), true);
  assert.equal(isCheckViolation({ code: "P2039", message: "Database error.", meta: { driverAdapterError: { cause: { originalCode: "23514" } } } }), true, "by the Postgres code alone");
  assert.equal(isCheckViolation({ message: constraint }), true, "by the message alone");
  for (const other of [
    { code: "P2002", message: "Unique constraint failed on the fields: (`tier`)" },
    { code: "P2034", message: "Transaction failed due to a write conflict or a deadlock. Please retry your transaction" },
    { code: "P2021", message: "The table `public.DeliveryTierSetting` does not exist in the current database." },
    { code: "P2039", message: "Database error. Code: `25P02`.", meta: { driverAdapterError: { cause: { originalCode: "25P02" } } } },
    new Error("check the constraint list"), null, undefined, "23514", 42,
  ]) assert.equal(isCheckViolation(other), false, JSON.stringify(other));
});

test("write conflicts are recognised wherever they surface, including the raw adapter error a failed COMMIT throws", () => {
  // What Prisma 7.10 rethrows when COMMIT of a serializable transaction fails: the pg adapter's error, no P2034 code.
  const atCommit = Object.assign(new Error("TransactionWriteConflict"), {
    name: "DriverAdapterError",
    cause: { originalCode: "40001", originalMessage: "could not serialize access due to read/write dependencies among transactions", kind: "TransactionWriteConflict" },
  });
  assert.equal(isWriteConflict(atCommit), true);
  assert.equal(isWriteConflict({ code: "P2034", message: "Transaction failed due to a write conflict or a deadlock. Please retry your transaction" }), true, "from a query");
  assert.equal(isWriteConflict(Object.assign(new Error("deadlock"), { name: "DriverAdapterError", cause: { originalCode: "40P01" } })), true, "a deadlock");
  for (const other of [
    Object.assign(new Error("TableDoesNotExist"), { name: "DriverAdapterError", cause: { originalCode: "42P01", kind: "TableDoesNotExist" } }),
    Object.assign(new Error("x"), { name: "DriverAdapterError" }),
    { name: "Error", cause: { kind: "TransactionWriteConflict" } },
    { code: "P2002" }, { code: "P2039", meta: { driverAdapterError: { cause: { originalCode: "23514" } } } }, null, "P2034",
  ]) assert.equal(isWriteConflict(other), false, JSON.stringify(other));
});

test("the admin API is same-site JSON only, checked before the session, and validates with parseTierSettingChange", () => {
  const route = source("../app/api/admin/delivery-tiers/route.ts");
  const guards = route.indexOf("rejectCrossSite(request) ?? requireJson(request)");
  const session = route.indexOf("await auth()");
  assert.ok(guards > 0 && session > guards, `guards (${guards}) run before auth (${session})`);
  assert.match(route, /if \(blocked\) return blocked;/);
  assert.match(route, /session\.user\.role !== "ADMIN"/);
  assert.match(route, /consumeRateLimit\(`admin-delivery-tiers:\$\{session\.user\.id\}`/);
  assert.ok(route.indexOf("parseTierSettingChange(body)") > route.indexOf("consumeRateLimit("), "the body is read only after the rate limit");
  assert.doesNotMatch(route, /export async function (GET|POST|PUT|DELETE)\b/, "PATCH is the only way in");
  assert.equal(existsSync(new URL("../app/api/admin/delivery-tiers/[tier]", import.meta.url)), false, "a static path, no [tier] segment");
});

test("the page checks the admin role first, and the settings component stays out of the server-only graph", () => {
  const page = source("../app/admin/delivery-tiers/page.tsx");
  const guard = page.indexOf('await requireRole("ADMIN")');
  assert.ok(guard > 0 && guard < page.indexOf("await loadDeliveryTierAdminView()"), "the role is checked before any data is read");
  // Follow every runtime import from the client component: none may reach server-only, db.ts or the Prisma runtime.
  const seen = new Set<string>();
  const visit = (url: URL) => {
    const path = fileURLToPath(url);
    if (seen.has(path)) return;
    seen.add(path);
    const text = readFileSync(path, "utf8");
    assert.doesNotMatch(text, /^import ["']server-only["']/m, `${path} is server-only`);
    assert.doesNotMatch(text, /^import (?!type )[^;]*from ["']@prisma\/client["']/m, `${path} imports the Prisma runtime`);
    for (const [, specifier] of text.matchAll(/^import (?!type )[^;]*?from ["'](\.[^"']+)["']/gm)) {
      const next = [".ts", ".tsx", "/index.ts"].map((extension) => new URL(`${specifier}${extension}`, url)).find((candidate) => existsSync(candidate));
      assert.ok(next, `${specifier} from ${path} resolves`);
      assert.doesNotMatch(fileURLToPath(next), /[\\/]lib[\\/]db\.ts$/, `${path} imports db.ts`);
      visit(next);
    }
  };
  visit(new URL("../components/admin/DeliveryTierSettings.tsx", import.meta.url));
  assert.ok(seen.size >= 4, `followed ${seen.size} modules`);
  assert.match(source("../components/admin/DeliveryTierSettings.tsx"), /^"use client";/);
});
