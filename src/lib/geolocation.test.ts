import assert from "node:assert/strict";
import { test } from "node:test";
import { FAST_FIX, PRECISE_FIX, isCoarse, requestPosition } from "./geolocation";

type Success = (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type Failure = (failure: { code: number }) => void;

/** A fake navigator.geolocation that answers however the test says, after an optional delay. */
function fakeGeolocation(answer: (success: Success, failure: Failure) => void, delayMs = 0) {
  const calls: Array<{ enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number } | undefined> = [];
  return {
    calls,
    geolocation: {
      getCurrentPosition(success: Success, failure: Failure, options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }) {
        calls.push(options);
        setTimeout(() => answer(success, failure), delayMs);
      },
    },
  };
}

test("GPS success returns rounded coordinates and accuracy, using the fast first fix", async () => {
  const fake = fakeGeolocation((success) => success({ coords: { latitude: 6.81234567, longitude: 3.91234567, accuracy: 42.6 } }));
  const result = await requestPosition({ geolocation: fake.geolocation, secureContext: true }).result;
  assert.deepEqual(result, { ok: true, coordinates: { latitude: 6.812346, longitude: 3.912346 }, accuracy: 43 });
  assert.deepEqual(fake.calls[0], FAST_FIX, "low-power positioning first: answers in about a second instead of waiting for satellites");
  assert.equal(FAST_FIX.enableHighAccuracy, false);
  assert.ok(FAST_FIX.maximumAge > 0, "a recent cached fix is reused");
  assert.equal(PRECISE_FIX.enableHighAccuracy, true);
});

test("denied, unavailable and timed-out requests report why, so manual entry can take over", async () => {
  for (const [code, reason] of [[1, "denied"], [2, "unavailable"], [3, "timeout"]] as const) {
    const fake = fakeGeolocation((_success, failure) => failure({ code }));
    assert.deepEqual(await requestPosition({ geolocation: fake.geolocation, secureContext: true }).result, { ok: false, reason });
  }
});

test("no geolocation hardware or an insecure page is reported as unsupported without asking", async () => {
  assert.deepEqual(await requestPosition({ geolocation: undefined, secureContext: true }).result, { ok: false, reason: "unsupported" });
  const fake = fakeGeolocation((success) => success({ coords: { latitude: 6.8, longitude: 3.9, accuracy: 5 } }));
  assert.deepEqual(await requestPosition({ geolocation: fake.geolocation, secureContext: false }).result, { ok: false, reason: "unsupported" });
  assert.equal(fake.calls.length, 0, "the browser is never asked on an insecure page");
});

test("an unanswered permission prompt can't leave the form loading forever", async () => {
  const fake = fakeGeolocation(() => { /* never answers, like an ignored prompt */ });
  const started = Date.now();
  const result = await requestPosition({ geolocation: fake.geolocation, secureContext: true }, FAST_FIX, 30).result;
  assert.deepEqual(result, { ok: false, reason: "timeout" });
  assert.ok(Date.now() - started < 1_000);
});

test("cancelling settles immediately and a late answer is ignored", async () => {
  const fake = fakeGeolocation((success) => success({ coords: { latitude: 6.8, longitude: 3.9, accuracy: 5 } }), 40);
  const request = requestPosition({ geolocation: fake.geolocation, secureContext: true });
  request.cancel();
  assert.deepEqual(await request.result, { ok: false, reason: "cancelled" });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(await request.result, { ok: false, reason: "cancelled" }, "the late success did not overwrite the outcome");
});

test("a 0,0 'no fix' position and a throwing browser API are treated as unavailable", async () => {
  const zero = fakeGeolocation((success) => success({ coords: { latitude: 0, longitude: 0, accuracy: 10 } }));
  assert.deepEqual(await requestPosition({ geolocation: zero.geolocation, secureContext: true }).result, { ok: false, reason: "unavailable" });
  const throwing = { getCurrentPosition() { throw new Error("blocked by policy"); } };
  assert.deepEqual(await requestPosition({ geolocation: throwing, secureContext: true }).result, { ok: false, reason: "unavailable" });
});

test("coarse pins are flagged so a precise retry is offered", () => {
  assert.equal(isCoarse(30), false);
  assert.equal(isCoarse(450), true);
  assert.equal(isCoarse(null), true);
});
