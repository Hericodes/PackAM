import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_EMAIL_PREFERENCES, queueOrderUpdateEmail, readEmailPreferences, resetEmailProbe, updateEmailPreferences } from "./campaign-store";

afterEach(resetEmailProbe);

function fakeClient(ready: boolean, overrides: { savepoint?: () => Promise<unknown> } = {}) {
  const calls: string[] = [];
  const client = {
    calls,
    $queryRaw: async () => { calls.push("probe"); return [{ ready }]; },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      calls.push("savepoint");
      if (overrides.savepoint) return overrides.savepoint();
      return work({ emailDelivery: { createMany: async () => { calls.push("queued"); return { count: 1 }; } } });
    },
    emailPreference: {
      findUnique: async () => { calls.push("read"); return { morning: false, reminders: true, announcements: true, orderUpdates: true }; },
      upsert: async ({ update }: { update: Record<string, boolean> }) => { calls.push("upsert"); return { ...DEFAULT_EMAIL_PREFERENCES, ...update }; },
    },
  };
  return client as never as typeof client & Parameters<typeof queueOrderUpdateEmail>[0] & Parameters<typeof readEmailPreferences>[0];
}

const order = { userId: "u1", orderId: "o1", title: "On the way", message: "Your package dey road" };

test("before the email migration nothing is queued or saved, and the order is never affected", async () => {
  const client = fakeClient(false);
  assert.equal(await queueOrderUpdateEmail(client, order), false);
  assert.deepEqual(await readEmailPreferences(client, "u1"), { ready: false, preferences: DEFAULT_EMAIL_PREFERENCES });
  assert.equal(await updateEmailPreferences(client, "u1", { morning: false }), null);
  assert.deepEqual(client.calls, ["probe", "probe", "probe"], "only the probe ran");
});

test("an order update is queued in a savepoint", async () => {
  const client = fakeClient(true);
  assert.equal(await queueOrderUpdateEmail(client, order), true);
  assert.deepEqual(client.calls, ["probe", "savepoint", "queued"]);
});

test("a failing queue never fails the order, except a serialization conflict the order must retry", async () => {
  const broken = fakeClient(true, { savepoint: async () => { throw Object.assign(new Error("boom"), { name: "SomethingElse" }); } });
  assert.equal(await queueOrderUpdateEmail(broken, order), false, "swallowed");
  const conflict = fakeClient(true, { savepoint: async () => { throw Object.assign(new Error("conflict"), { code: "P2034" }); } });
  await assert.rejects(queueOrderUpdateEmail(conflict, order), /conflict/, "the order transaction must see it and retry");
});

test("preferences: no row means everything on; saving keeps the other kinds", async () => {
  const client = fakeClient(true);
  const read = await readEmailPreferences(client, "u1");
  assert.equal(read.ready, true);
  assert.equal(read.preferences.morning, false);
  assert.deepEqual(await updateEmailPreferences(client, "u1", { reminders: false }), { ...DEFAULT_EMAIL_PREFERENCES, reminders: false });
});
