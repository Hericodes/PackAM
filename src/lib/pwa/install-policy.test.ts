import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_INSTALL_STATE,
  MAX_DISMISSALS,
  MIN_PAGE_VIEWS,
  MIN_TIME_ON_SITE_MS,
  SNOOZE_MS,
  iosInstallRoute,
  isPromptPath,
  parseInstallState,
  recordDismissal,
  recordPageView,
  shouldAutoPrompt,
  type InstallState,
} from "./install-policy";

const NOW = 1_800_000_000_000;
const engaged: InstallState = { ...EMPTY_INSTALL_STATE, pageViews: MIN_PAGE_VIEWS, firstSeenAt: NOW - 1000 };
const context = { now: NOW, path: "/search", canInstall: true, standalone: false, cartCount: 0 };

test("the prompt waits until the visitor has looked around", () => {
  const fresh = recordPageView(EMPTY_INSTALL_STATE, NOW);
  assert.equal(shouldAutoPrompt(fresh, context), false, "not on the first page");
  assert.equal(shouldAutoPrompt(engaged, context), true, "after a few pages");
  assert.equal(shouldAutoPrompt(fresh, { ...context, now: NOW + MIN_TIME_ON_SITE_MS }), true, "or after some time on the site");
});

test("never when installed, unsupported, or on checkout, payment, printing, sign-in or admin pages", () => {
  assert.equal(shouldAutoPrompt(engaged, { ...context, standalone: true }), false);
  assert.equal(shouldAutoPrompt({ ...engaged, installed: true }, context), false);
  assert.equal(shouldAutoPrompt(engaged, { ...context, canInstall: false }), false);
  for (const path of ["/checkout", "/checkout/success", "/printing", "/printing/jobs/1", "/login", "/register", "/admin", "/orders/abc", "/runner"]) {
    assert.equal(isPromptPath(path), false, path);
    assert.equal(shouldAutoPrompt(engaged, { ...context, path }), false, path);
  }
  for (const path of ["/", "/search", "/products/abc", "/food", "/orders"]) assert.equal(isPromptPath(path), true, path);
});

test("not while the student has something in their cart", () => {
  assert.equal(shouldAutoPrompt(engaged, { ...context, cartCount: 1 }), false);
});

test("Maybe later rests it for two weeks, and after three times it stops appearing by itself", () => {
  const once = recordDismissal(engaged, NOW);
  assert.equal(shouldAutoPrompt(once, { ...context, now: NOW + SNOOZE_MS - 1 }), false);
  assert.equal(shouldAutoPrompt(once, { ...context, now: NOW + SNOOZE_MS }), true);
  let many = engaged;
  for (let i = 0; i < MAX_DISMISSALS; i += 1) many = recordDismissal(many, NOW - SNOOZE_MS * 10);
  assert.equal(shouldAutoPrompt(many, context), false);
});

test("stored state is read defensively", () => {
  assert.deepEqual(parseInstallState(null), EMPTY_INSTALL_STATE);
  assert.deepEqual(parseInstallState("{oops"), EMPTY_INSTALL_STATE);
  assert.deepEqual(parseInstallState(JSON.stringify({ pageViews: -4, firstSeenAt: "x", dismissedAt: 5, dismissals: 2.7, installed: "yes" })), { pageViews: 0, firstSeenAt: 0, dismissedAt: 5, dismissals: 2, installed: false });
  const round = recordPageView(recordDismissal(engaged, NOW), NOW);
  assert.deepEqual(parseInstallState(JSON.stringify(round)), round);
});

test("iPhone and iPad: Safari and iOS 16.4+ browsers get Add to Home Screen; in-app browsers are sent to Safari", () => {
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const chrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
  const oldChrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/108.0 Mobile/15E148 Safari/604.1";
  const instagram = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.0.0";
  const facebook = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]";
  const ipadDesktop = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  assert.equal(iosInstallRoute(safari), "ios-safari");
  assert.equal(iosInstallRoute(chrome), "ios-browser");
  assert.equal(iosInstallRoute(oldChrome), "ios-open-in-safari");
  assert.equal(iosInstallRoute(instagram), "ios-open-in-safari");
  assert.equal(iosInstallRoute(facebook), "ios-open-in-safari");
  assert.equal(iosInstallRoute(ipadDesktop, "MacIntel", 5), "ios-safari", "iPadOS reports a Mac with touch");
  assert.equal(iosInstallRoute(ipadDesktop, "MacIntel", 0), null, "a real Mac");
  assert.equal(iosInstallRoute("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"), null, "Android uses the browser's own prompt");
});
