import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketKeys, campusDay, campusDayStart, change, fillSeries, parseRange, rate } from "./range";
import { isBot, normalisePath, optedOut, parsePageView, referrerHostOf } from "./tracking";

// 23:30 UTC on 9 March is already 10 March on campus (UTC+1).
const NOW = new Date("2026-03-09T23:30:00Z");

test("campus days are Lagos days", () => {
  assert.equal(campusDay(NOW), "2026-03-10");
  assert.equal(campusDayStart("2026-03-10").toISOString(), "2026-03-09T23:00:00.000Z");
});

test("presets include today and compare with the period just before", () => {
  const week = parseRange({ range: "7d" }, NOW);
  assert.ok(week.ok);
  assert.equal(week.range.fromDay, "2026-03-04");
  assert.equal(week.range.toDay, "2026-03-10");
  assert.equal(week.range.to.toISOString(), "2026-03-10T23:00:00.000Z");
  assert.equal(week.range.previousTo.getTime(), week.range.from.getTime());
  assert.equal(week.range.from.getTime() - week.range.previousFrom.getTime(), 7 * 24 * 3600 * 1000);
  assert.equal(week.range.bucket, "day");
  const today = parseRange({ range: "today" }, NOW);
  assert.ok(today.ok);
  assert.equal(today.range.bucket, "hour");
  assert.equal(bucketKeys(today.range).length, 24);
  assert.equal(bucketKeys(today.range)[0], "2026-03-10 00:00");
  const defaulted = parseRange({}, NOW);
  assert.ok(defaulted.ok && defaulted.range.key === "30d");
});

test("custom ranges are validated, never silently replaced", () => {
  const ok = parseRange({ from: "2026-02-01", to: "2026-02-03" }, NOW);
  assert.ok(ok.ok);
  assert.deepEqual(bucketKeys(ok.range), ["2026-02-01", "2026-02-02", "2026-02-03"]);
  for (const bad of [{ range: "1y" }, { from: "2026-02-03", to: "2026-02-01" }, { from: "2026-03-01", to: "2026-03-11" }, { from: "2025-01-01", to: "2026-03-01" }, { from: "2026-02-30", to: "2026-03-01" }, { from: "2026-02-01" }]) {
    assert.equal(parseRange(bad, NOW).ok, false, JSON.stringify(bad));
  }
});

test("series fill every bucket; rates and changes avoid dividing by nothing", () => {
  const r = parseRange({ from: "2026-02-01", to: "2026-02-03" }, NOW);
  assert.ok(r.ok);
  assert.deepEqual(fillSeries(r.range, [{ bucket: "2026-02-02", value: 5 }]).map((p) => p.value), [0, 5, 0]);
  assert.equal(rate(1, 4), 25);
  assert.equal(rate(1, 3), 33.3);
  assert.equal(rate(1, 0), null);
  assert.equal(change(12, 10), 20);
  assert.equal(change(5, 0), null, "no previous activity: no percentage");
  assert.equal(change(5, 4, false), null, "not comparable (e.g. before tracking began)");
});

test("page paths drop ids, queries and fragments", () => {
  assert.equal(normalisePath("/products/cmvrtbyvt00049oqry328fzau?x=1#top"), "/products/:id");
  assert.equal(normalisePath("/orders/123e4567-e89b-12d3-a456-426614174000"), "/orders/:id");
  assert.equal(normalisePath("/search/"), "/search");
  assert.equal(normalisePath("/"), "/");
  assert.equal(normalisePath("/food/ui-shop-a"), "/food/ui-shop-a", "readable slugs stay");
});

test("referrers: other sites only, host only", () => {
  assert.equal(referrerHostOf("https://www.instagram.com/p/123?utm=1", "packam.vercel.app"), "instagram.com");
  assert.equal(referrerHostOf("https://packam.vercel.app/search", "packam.vercel.app"), null);
  assert.equal(referrerHostOf("javascript:alert(1)", "packam.vercel.app"), null);
  assert.equal(referrerHostOf(null, "packam.vercel.app"), null);
});

test("bots, headless browsers and opted-out visitors are skipped; staff pages and bad ids refused", () => {
  assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"), false);
  for (const ua of [null, "Googlebot/2.1", "Mozilla/5.0 HeadlessChrome/126", "WhatsApp/2.23", "curl/8.0"]) assert.equal(isBot(ua), true, String(ua));
  const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name] ?? null });
  assert.equal(optedOut(headers({ dnt: "1" })), true);
  assert.equal(optedOut(headers({ "sec-gpc": "1" })), true);
  assert.equal(optedOut(headers({})), false);
  const base = { viewId: "11111111-aaaa", visitorId: "22222222-bbbb", sessionId: "33333333-cccc" };
  assert.deepEqual(parsePageView({ ...base, path: "/admin/orders" }, "x"), { ok: false, reason: "staff-page" });
  assert.deepEqual(parsePageView({ ...base, path: "/runner" }, "x"), { ok: false, reason: "staff-page" });
  assert.deepEqual(parsePageView({ ...base, viewId: "short", path: "/" }, "x"), { ok: false, reason: "invalid" });
  assert.deepEqual(parsePageView({ ...base, path: "/", referrer: "https://t.co/x" }, "x"), { ok: true, view: { ...base, path: "/", referrerHost: "t.co" } });
});
