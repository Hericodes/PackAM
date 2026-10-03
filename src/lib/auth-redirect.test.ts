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
