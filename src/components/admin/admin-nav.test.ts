import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_NAV, adminNavFor, isAdminNavActive } from "./admin-nav";

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

test("normal admins don't see Finance, Analytics, the Audit log or Admins; the super admin sees everything", () => {
  const hrefs = (level: "super" | "admin") => adminNavFor(level).flatMap((group) => group.items.map((item) => item.href));
  for (const href of ["/admin/finance", "/admin/analytics", "/admin/audit", "/admin/admins"]) {
    assert.ok(hrefs("super").includes(href), href);
    assert.ok(!hrefs("admin").includes(href), href);
  }
  for (const href of ["/admin/orders", "/admin/payments", "/admin/promo-codes", "/admin/emails", "/runner", "/food"]) assert.ok(hrefs("admin").includes(href), href);
  assert.ok(adminNavFor("admin").every((group) => group.items.length > 0), "no empty groups");
});
