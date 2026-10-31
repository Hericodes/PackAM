import assert from "node:assert/strict";
import { test } from "node:test";
import { rejectCrossSite, requireJson } from "./request-guards";

const ENDPOINT = "https://packam.example/api/account/password";

function post(headers: Record<string, string>, url = ENDPOINT) {
  return new Request(url, { method: "POST", headers });
}

test("same-origin browser requests, and requests without browser headers, pass", () => {
  assert.equal(rejectCrossSite(post({})), null, "server-to-server calls and database tests");
  assert.equal(rejectCrossSite(post({ "sec-fetch-site": "same-origin", origin: "https://packam.example" })), null);
  assert.equal(rejectCrossSite(post({ "sec-fetch-site": "none" })), null, "started by the person, not a page");
  assert.equal(rejectCrossSite(post({ origin: "https://packam.example" })), null, "browsers without Sec-Fetch-Site still send Origin");
  // Behind a proxy the request URL can carry an internal name; the forwarded or Host header has the public one.
  assert.equal(rejectCrossSite(post({ origin: "https://packam.example", "x-forwarded-host": "packam.example, edge.internal" }, "http://localhost:3000/api/x")), null);
  assert.equal(rejectCrossSite(post({ origin: "https://packam.example", host: "packam.example" }, "http://localhost:3000/api/x")), null);
});

test("requests from another site are refused with 403", async () => {
  const cases: Array<Record<string, string>> = [
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "Cross-Site", origin: "https://packam.example" },
    { "sec-fetch-site": "same-site", origin: "https://shop.packam.example" },
    { "sec-fetch-site": "same-origin", origin: "https://evil.example" },
    { origin: "https://evil.example" },
    { origin: "https://packam.example.evil.example" },
    { origin: "http://packam.example:8080" },
    { origin: "null" },
    { origin: "file://" },
    { origin: "" },
  ];
  for (const headers of cases) {
    const response = rejectCrossSite(post(headers));
    assert.equal(response?.status, 403, JSON.stringify(headers));
    const body = await response!.json();
    assert.equal(body.code, "CROSS_SITE_REQUEST");
    assert.match(body.error, /didn’t come from PackAM/);
  }
});

test("bodies must be declared as JSON: only the media type before any parameters counts", async () => {
  for (const type of ["application/json", "application/json; charset=utf-8", "Application/JSON ;charset=UTF-8"]) {
    assert.equal(requireJson(post({ "content-type": type })), null, type);
  }
  // "text/plain; application/json" is a text/plain body to a browser, which sends it across sites without asking.
  for (const type of [undefined, "text/plain", "text/plain; application/json", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonp", "application/json-patch+json"]) {
    const response = requireJson(post(type === undefined ? {} : { "content-type": type }));
    assert.equal(response?.status, 415, String(type));
    assert.equal((await response!.json()).code, "JSON_REQUIRED");
  }
});
