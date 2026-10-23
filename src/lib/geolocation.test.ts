import assert from "node:assert/strict";
import { test } from "node:test";
import { FAST_FIX, PRECISE_FIX, isCoarse, requestPosition, requestPositionWithFallback } from "./geolocation";

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

test("fallback: a fast Wi-Fi/cell fix is used as-is, with no second request", async () => {
  const fake = fakeGeolocation((success) => success({ coords: { latitude: 6.81, longitude: 3.91, accuracy: 30 } }));
  const result = await requestPositionWithFallback({ geolocation: fake.geolocation, secureContext: true }).result;
  assert.equal(result.ok, true);
  assert.deepEqual(fake.calls, [FAST_FIX]);
});

test("fallback: when the fast fix finds nothing or times out, satellite GPS gets one try", async () => {
  for (const code of [2, 3]) {
    let call = 0;
    const fake = fakeGeolocation((success, failure) => (++call === 1 ? failure({ code }) : success({ coords: { latitude: 6.812345, longitude: 3.912345, accuracy: 8 } })));
    const result = await requestPositionWithFallback({ geolocation: fake.geolocation, secureContext: true }).result;
    assert.deepEqual(result, { ok: true, coordinates: { latitude: 6.812345, longitude: 3.912345 }, accuracy: 8 }, `code ${code}`);
    assert.deepEqual(fake.calls, [FAST_FIX, PRECISE_FIX], `code ${code}`);
  }
});

test("fallback: if GPS also fails, the real reason is reported so manual entry takes over", async () => {
  const fake = fakeGeolocation((_success, failure) => failure({ code: 2 }));
  assert.deepEqual(await requestPositionWithFallback({ geolocation: fake.geolocation, secureContext: true }).result, { ok: false, reason: "unavailable" });
  assert.equal(fake.calls.length, 2, "two attempts, never more");
});

test("fallback: a denial or an unsupported browser is final, the student is never asked twice", async () => {
  const denied = fakeGeolocation((_success, failure) => failure({ code: 1 }));
  assert.deepEqual(await requestPositionWithFallback({ geolocation: denied.geolocation, secureContext: true }).result, { ok: false, reason: "denied" });
  assert.equal(denied.calls.length, 1);
  assert.deepEqual(await requestPositionWithFallback({ geolocation: undefined, secureContext: true }).result, { ok: false, reason: "unsupported" });
});

test("fallback: cancelling during either attempt stops everything", async () => {
  const first = fakeGeolocation((success) => success({ coords: { latitude: 6.8, longitude: 3.9, accuracy: 5 } }), 40);
  const a = requestPositionWithFallback({ geolocation: first.geolocation, secureContext: true });
  a.cancel();
  assert.deepEqual(await a.result, { ok: false, reason: "cancelled" });
  assert.equal(first.calls.length, 1);

  let call = 0;
  const second = fakeGeolocation((success, failure) => (++call === 1 ? failure({ code: 3 }) : success({ coords: { latitude: 6.8, longitude: 3.9, accuracy: 5 } })), 20);
  const b = requestPositionWithFallback({ geolocation: second.geolocation, secureContext: true });
  await new Promise((resolve) => setTimeout(resolve, 30)); // first attempt has failed; GPS attempt in flight
  b.cancel();
  assert.deepEqual(await b.result, { ok: false, reason: "cancelled" });
});
