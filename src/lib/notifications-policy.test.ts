import test from "node:test";
import assert from "node:assert/strict";
import { notificationOwnerWhere, stableNotificationKey } from "./notifications-policy";

test("notification reads and mutations are scoped to one authenticated owner", () => {
  assert.deepEqual(notificationOwnerWhere("user-a"), { userId: "user-a" });
  assert.notDeepEqual(notificationOwnerWhere("user-a"), notificationOwnerWhere("user-b"));
});

test("notification event key is stable across retries and distinct across events", () => {
  assert.equal(stableNotificationKey("delivered", "order-1"), stableNotificationKey("delivered", "order-1"));
  assert.notEqual(stableNotificationKey("delivered", "order-1"), stableNotificationKey("refund", "order-1"));
});
