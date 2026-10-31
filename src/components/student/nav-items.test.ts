import assert from "node:assert/strict";
import { test } from "node:test";
import { isNavItemActive, navItemsFor } from "./nav-items";

test("every signed-in role reaches Settings from its menu; visitors who aren't signed in don't", () => {
  for (const role of ["STUDENT", "RUNNER", "ADMIN"] as const) {
    const { primary, secondary } = navItemsFor(role);
    const settings = secondary.filter((item) => item.href === "/settings");
    assert.equal(settings.length, 1, `${role}: one Settings item in the menu`);
    assert.deepEqual(settings[0], { href: "/settings", label: "Settings", icon: "settings" });
    assert.ok(!primary.some((item) => item.href === "/settings"), `${role}: not in the main bar`);
  }
  const visitor = navItemsFor(null);
  assert.ok(![...visitor.primary, ...visitor.secondary].some((item) => item.href === "/settings"));
});

test("students keep their account pages, with Settings before help", () => {
  assert.deepEqual(navItemsFor("STUDENT").secondary.map((item) => item.href), ["/account", "/product-requests", "/settings", "/support"]);
  assert.deepEqual(navItemsFor("RUNNER").secondary.map((item) => item.href), ["/settings", "/support"]);
  assert.deepEqual(navItemsFor("ADMIN").secondary.map((item) => item.href), ["/settings"]);
});

test("the Settings item is marked current on /settings only", () => {
  const settings = navItemsFor("RUNNER").secondary[0];
  assert.equal(isNavItemActive(settings, "/settings"), true);
  assert.equal(isNavItemActive(settings, "/settings/anything"), true);
  assert.equal(isNavItemActive(settings, "/settingsx"), false);
  assert.equal(isNavItemActive(settings, "/account"), false);
});
