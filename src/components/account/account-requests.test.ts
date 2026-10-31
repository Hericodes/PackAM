import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  EMAIL_CHANGE_STATUSES,
  NETWORK_ERROR,
  SESSION_ENDED,
  UPDATING_ERROR,
  accountRequest,
  emailChangeNotice,
  isEmailChangeStatus,
  linkExpiryLabel,
  parseBlockers,
  problemMessage,
  readFailure,
  retryWhen,
} from "./account-requests";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replaces fetch for one test and records what it was asked. */
function stubFetch(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return calls;
}

test("account requests always send JSON with a JSON content type, and read the JSON answer", async () => {
  const calls = stubFetch(() => Response.json({ firstName: "Ada", lastName: "Lovelace" }));
  const result = await accountRequest<{ firstName: string }>("/api/account/profile", "PATCH", { firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(result, { ok: true, data: { firstName: "Ada", lastName: "Lovelace" } });
  assert.equal(calls[0].url, "/api/account/profile");
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(calls[0].init.headers, { "Content-Type": "application/json" });
  assert.equal(calls[0].init.body, JSON.stringify({ firstName: "Ada", lastName: "Lovelace" }));

  const bodiless = stubFetch(() => Response.json({ ok: true, cancelled: true }));
  await accountRequest("/api/account/email", "DELETE");
  assert.equal(bodiless[0].init.body, undefined, "a DELETE without data sends no body");
  assert.deepEqual(bodiless[0].init.headers, { "Content-Type": "application/json" }, "but still says JSON");
});

test("account requests never throw: no connection is status 0, and an unreadable answer has no message", async () => {
  stubFetch(() => { throw new TypeError("Failed to fetch"); });
  const offline = await accountRequest("/api/account/password", "POST", { currentPassword: "x", newPassword: "y" });
  assert.equal(offline.ok, false);
  assert.equal(!offline.ok && offline.status, 0);
  assert.equal(!offline.ok && problemMessage(offline, "fallback"), NETWORK_ERROR);

  stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }));
  const garbled = await accountRequest("/api/account/password", "POST", {});
  assert.equal(!garbled.ok && garbled.status, 502);
  assert.equal(!garbled.ok && garbled.error, "");
  assert.equal(!garbled.ok && problemMessage(garbled, "We couldn’t change your password."), "We couldn’t change your password.");

  stubFetch(() => new Response(null, { status: 200 }));
  assert.deepEqual(await accountRequest("/api/account/email", "DELETE"), { ok: true, data: {} }, "an empty success still counts");
});

test("error answers are read defensively: code, message, field problems, blockers and the wait", () => {
  const failure = readFailure(400, {
    error: " Enter your first name. ",
    code: "INVALID_NAME",
    fields: { firstName: "Enter your first name.", lastName: 42, middle: "  " },
  }, null);
  assert.equal(failure.code, "INVALID_NAME");
  assert.equal(failure.error, "Enter your first name.");
  assert.deepEqual(failure.fields, { firstName: "Enter your first name." }, "only non-empty strings survive");
  assert.deepEqual(failure.blockers, []);
  assert.equal(failure.retryAfterSeconds, null);

  assert.equal(readFailure(429, { retryAfterSeconds: 42.2 }, "3600").retryAfterSeconds, 43, "the body's own wait wins over the header");
  assert.equal(readFailure(429, {}, " 120 ").retryAfterSeconds, 120);
  assert.equal(readFailure(429, {}, "Wed, 21 Oct 2026 07:28:00 GMT").retryAfterSeconds, null, "an HTTP date isn't guessed at");
  assert.equal(readFailure(429, { retryAfterSeconds: -5 }, "0").retryAfterSeconds, null);
  assert.deepEqual(readFailure(500, ["not", "an", "object"], null), { status: 500, code: undefined, error: "", fields: {}, blockers: [], retryAfterSeconds: null });
});

test("deletion blockers keep only well-formed entries", () => {
  assert.deepEqual(parseBlockers([
    { kind: "ORDER_IN_PROGRESS", message: "You have an order in progress.", count: 1 },
    { kind: "REFUND_UNSETTLED", message: "   " },
    { kind: 3, message: "Not a kind" },
    "junk",
    null,
  ]), [{ kind: "ORDER_IN_PROGRESS", message: "You have an order in progress." }]);
  assert.deepEqual(parseBlockers({ kind: "x", message: "y" }), []);
  assert.deepEqual(readFailure(409, { code: "DELETION_BLOCKED", blockers: [{ kind: "SUPPORT_CASE_OPEN", message: "You have an open support request." }] }, null).blockers, [
    { kind: "SUPPORT_CASE_OPEN", message: "You have an open support request." },
  ]);
});

test("form messages: offline, signed out and updating have their own words; otherwise the server's, then the fallback", () => {
  const base = { fields: {}, blockers: [], retryAfterSeconds: null };
  assert.equal(problemMessage({ ...base, status: 401, error: "Sign in to manage your account.", code: "SIGN_IN_REQUIRED" }, "x"), SESSION_ENDED);
  assert.equal(problemMessage({ ...base, status: 503, error: "PackAM is being updated. Your cart is safe — please try again in a few minutes.", code: "SERVICE_UPDATING" }, "x"), UPDATING_ERROR);
  assert.doesNotMatch(UPDATING_ERROR, /cart/i, "settings never talks about a cart");
  assert.equal(problemMessage({ ...base, status: 503, error: "PackAM can’t send emails right now.", code: "EMAIL_NOT_CONFIGURED" }, "x"), "PackAM can’t send emails right now.");
  assert.equal(problemMessage({ ...base, status: 429, error: "We’ve just sent you a link." }, "x"), "We’ve just sent you a link.");
  assert.equal(problemMessage({ ...base, status: 429, error: "", retryAfterSeconds: 600 }, "x"), "Too many attempts. Please try again in about 10 minutes.");
  assert.equal(problemMessage({ ...base, status: 500, error: "" }, "We couldn’t save your name."), "We couldn’t save your name.");
});

test("retry times read naturally", () => {
  assert.equal(retryWhen(null), "a little later");
  assert.equal(retryWhen(0), "a little later");
  assert.equal(retryWhen(Number.NaN), "a little later");
  assert.equal(retryWhen(45), "in a minute");
  assert.equal(retryWhen(60), "in a minute");
  assert.equal(retryWhen(61), "in about 2 minutes");
  assert.equal(retryWhen(3600), "in about 60 minutes");
  assert.equal(retryWhen(2 * 3600), "in about 2 hours");
});

test("link expiry is shown in campus time, and anything that isn't a date is left out", () => {
  // 08:41 UTC is 09:41 in Lagos (UTC+1, no daylight saving).
  const label = linkExpiryLabel("2026-11-01T08:41:00.000Z");
  assert.ok(label, "a date gives a label");
  assert.match(label, /1 Nov 2026/);
  assert.match(label, /9:41/);
  assert.equal(linkExpiryLabel(new Date("2026-11-01T08:41:00.000Z")), label);
  assert.equal(linkExpiryLabel("not a date"), null);
  assert.equal(linkExpiryLabel(undefined), null);
  assert.equal(linkExpiryLabel(1_700_000_000_000), null);
});

test("email change results: the five statuses the confirm link sends, each with a banner", () => {
  assert.deepEqual([...EMAIL_CHANGE_STATUSES], ["changed", "invalid", "expired", "used", "taken"]);
  for (const status of EMAIL_CHANGE_STATUSES) assert.ok(isEmailChangeStatus(status), status);
  for (const other of ["verified", "CHANGED", "", undefined, ["changed"], "__proto__", "toString"]) assert.equal(isEmailChangeStatus(other), false, String(other));

  const changed = emailChangeNotice("changed", "ada@uni.example");
  assert.equal(changed.tone, "success");
  assert.match(changed.message, /ada@uni\.example/);
  for (const status of EMAIL_CHANGE_STATUSES.filter((value) => value !== "changed")) {
    const notice = emailChangeNotice(status, "ada@uni.example");
    assert.equal(notice.tone, "error", status);
    assert.match(notice.message, /hasn’t changed/, `${status}: says nothing changed`);
    assert.doesNotMatch(notice.message, /ada@uni\.example/, `${status}: no address needed`);
  }
});
