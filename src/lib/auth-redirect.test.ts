import assert from "node:assert/strict";
import test from "node:test";
import { resolvePostLoginDestination, roleHome } from "./auth-redirect";

test("login defaults to each authenticated role's home", () => {
  assert.equal(roleHome("STUDENT"), "/");
  assert.equal(roleHome("RUNNER"), "/runner");
  assert.equal(roleHome("ADMIN"), "/admin");
});

test("authorized internal destinations are preserved", () => {
  assert.equal(resolvePostLoginDestination("STUDENT", "/checkout?from=cart"), "/checkout?from=cart");
  assert.equal(resolvePostLoginDestination("STUDENT", "/orders/order_123"), "/orders/order_123");
  assert.equal(resolvePostLoginDestination("RUNNER", "/runner/missions/mission_123"), "/runner/missions/mission_123");
  assert.equal(resolvePostLoginDestination("ADMIN", "/admin/orders/order_123"), "/admin/orders/order_123");
});

test("students return to printing, food, their account and saved items, and every page under them", () => {
  for (const path of [
    "/printing", "/printing/jobs/job_123", "/printing/payment/job_123?reference=abc",
    "/food", "/food/shop_123", "/account", "/account#addresses", "/saved", "/settings", "/settings?email=changed",
  ]) {
    assert.equal(resolvePostLoginDestination("STUDENT", path), path, path);
  }
});

test("every role can return to settings, but not to another role's pages", () => {
  for (const role of ["STUDENT", "RUNNER", "ADMIN"]) {
    assert.equal(resolvePostLoginDestination(role, "/settings"), "/settings", role);
    assert.equal(resolvePostLoginDestination(role, "/settings/password"), "/settings/password", role);
  }
  assert.equal(resolvePostLoginDestination("RUNNER", "/printing"), "/runner");
  assert.equal(resolvePostLoginDestination("RUNNER", "/account"), "/runner");
  assert.equal(resolvePostLoginDestination("ADMIN", "/food/shop_123"), "/admin");
  assert.equal(resolvePostLoginDestination("ADMIN", "/saved"), "/admin");
  assert.equal(resolvePostLoginDestination("UNKNOWN", "/settings"), "/", "an unknown role gets nothing");
});

test("section names match whole path segments only", () => {
  assert.equal(resolvePostLoginDestination("STUDENT", "/settingsx"), "/");
  assert.equal(resolvePostLoginDestination("STUDENT", "/printing-admin"), "/");
  assert.equal(resolvePostLoginDestination("RUNNER", "/settings-old"), "/runner");
  assert.equal(resolvePostLoginDestination("STUDENT", "/accounts"), "/");
});

test("cross-role and external callback URLs fall back to the authenticated role home", () => {
  assert.equal(resolvePostLoginDestination("STUDENT", "/admin"), "/");
  assert.equal(resolvePostLoginDestination("STUDENT", "/runner"), "/");
  assert.equal(resolvePostLoginDestination("RUNNER", "/admin"), "/runner");
  assert.equal(resolvePostLoginDestination("ADMIN", "/checkout"), "/admin");
  assert.equal(resolvePostLoginDestination("STUDENT", "https://example.com"), "/");
  assert.equal(resolvePostLoginDestination("STUDENT", "//example.com"), "/");
  assert.equal(resolvePostLoginDestination("STUDENT", "/\\\\example.com"), "/");
  assert.equal(resolvePostLoginDestination("STUDENT", "/%2f%2fexample.com"), "/");
});

test("dot segments are resolved before the allowlist, so a new section can't be used to escape", () => {
  assert.equal(resolvePostLoginDestination("STUDENT", "/settings/../admin"), "/");
  assert.equal(resolvePostLoginDestination("STUDENT", "/printing/%2e%2e/admin"), "/");
  assert.equal(resolvePostLoginDestination("RUNNER", "/settings/./../admin/orders"), "/runner");
  assert.equal(resolvePostLoginDestination("STUDENT", "/food/..//example.com"), "/");
  assert.equal(resolvePostLoginDestination("STUDENT", "/saved/../orders"), "/orders", "a path that resolves inside the allowlist is kept");
  assert.equal(resolvePostLoginDestination("STUDENT", "/settings%5c..%5cadmin"), "/");
  assert.equal(resolvePostLoginDestination("STUDENT", "/account\u0000"), "/");
});
