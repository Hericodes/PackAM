import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { PromoCodeRejectedError } from "./promo-rules";
import { promoTablesReady, resetPromoProbe, resolveCheckoutPromo } from "./promo-store";

afterEach(resetPromoProbe);

/** A fake client: the probe answers `ready`; the savepoint runs `lookup` with fake promo tables. */
function fakeClient(ready: boolean, lookup?: { code: Record<string, unknown> | null; usesTotal?: number; usesByStudent?: number }) {
  const calls: string[] = [];
  const client = {
    calls,
    $queryRaw: async () => { calls.push("probe"); return [{ ready }]; },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      calls.push("savepoint");
      return work({
        promoCode: { findUnique: async () => lookup?.code ?? null },
        promoRedemption: { count: async ({ where }: { where: { userId?: string } }) => (where.userId ? lookup?.usesByStudent ?? 0 : lookup?.usesTotal ?? 0) },
      });
    },
  };
  return client as typeof client & Parameters<typeof resolveCheckoutPromo>[0];
}

const stored = { id: "p1", code: "WELCOME1K", type: "FIXED", value: 1_000, maxDiscount: null, minSubtotal: 0, maxUses: null, maxUsesPerStudent: 1, startsAt: null, endsAt: null, active: true };
const rejected = (reason: string) => (error: unknown) => error instanceof PromoCodeRejectedError && error.reason === reason;

test("before the promo migration a code is refused as not available yet, and nothing else is queried", async () => {
  const client = fakeClient(false);
  await assert.rejects(resolveCheckoutPromo(client, "WELCOME1K", "u1", 5_000), rejected("UNAVAILABLE"));
  assert.deepEqual(client.calls, ["probe"]);
  assert.equal(await promoTablesReady(client), false, "missing tables are probed again on every call, never remembered");
  assert.deepEqual(client.calls, ["probe", "probe"]);
});

test("a malformed code is refused before the database is touched", async () => {
  const client = fakeClient(true);
  await assert.rejects(resolveCheckoutPromo(client, "NO-SUCH-CODE!", "u1", 5_000), rejected("INVALID"));
  assert.deepEqual(client.calls, []);
});

test("a usable code returns its discount, label and rule; the lookup runs in a savepoint", async () => {
  const client = fakeClient(true, { code: stored });
  const promo = await resolveCheckoutPromo(client, "welcome1k", "u1", 5_000);
  assert.deepEqual(promo, { promoCodeId: "p1", code: "WELCOME1K", discount: 1_000, label: "₦1,000 off your items", rule: { type: "FIXED", value: 1_000, maxDiscount: null, minSubtotal: 0 } });
  assert.deepEqual(client.calls, ["probe", "savepoint"]);
  await resolveCheckoutPromo(client, "WELCOME1K", "u1", 5_000);
  assert.deepEqual(client.calls, ["probe", "savepoint", "savepoint"], "ready is remembered: no second probe");
});

test("refusals come back with their reason", async () => {
  await assert.rejects(resolveCheckoutPromo(fakeClient(true, { code: null }), "WELCOME1K", "u1", 5_000), rejected("NOT_FOUND"));
  await assert.rejects(resolveCheckoutPromo(fakeClient(true, { code: stored, usesByStudent: 1 }), "WELCOME1K", "u1", 5_000), rejected("ALREADY_USED"));
  await assert.rejects(resolveCheckoutPromo(fakeClient(true, { code: { ...stored, maxUses: 5 }, usesTotal: 5 }), "WELCOME1K", "u1", 5_000), rejected("USED_UP"));
});
