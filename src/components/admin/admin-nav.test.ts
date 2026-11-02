import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_NAV, isAdminNavActive } from "./admin-nav";

test("Delivery tiers appears once, under Management, right after Runners", () => {
  const items = ADMIN_NAV.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
  const matches = items.filter((item) => item.href === "/admin/delivery-tiers");
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0], { href: "/admin/delivery-tiers", label: "Delivery tiers", icon: "clock", group: "Management" });
  const management = ADMIN_NAV.find((group) => group.label === "Management")!.items.map((item) => item.href);
  assert.equal(management[management.indexOf("/admin/runners") + 1], "/admin/delivery-tiers");
  assert.equal(new Set(items.map((item) => item.href)).size, items.length, "no duplicate destinations");
});

test("only Delivery tiers is highlighted on its page", () => {
  const active = ADMIN_NAV.flatMap((group) => group.items).filter((item) => isAdminNavActive(item.href, "/admin/delivery-tiers"));
  assert.deepEqual(active.map((item) => item.href), ["/admin/delivery-tiers"]);
});
