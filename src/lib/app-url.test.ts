import assert from "node:assert/strict";
import { test } from "node:test";
import { AppUrlConfigError, appUrl, buildAppUrl, parseAppUrl } from "./app-url";

test("APP_URL is required, absolute, and HTTPS in production; messages never repeat the value", () => {
  assert.equal(parseAppUrl("https://packam.example", "production").origin, "https://packam.example");
  assert.equal(parseAppUrl("  http://localhost:3000/ ", "development").origin, "http://localhost:3000", "plain http is fine locally");
  const cases: Array<[string | undefined, string | undefined, RegExp]> = [
    [undefined, "production", /required/],
    ["", "development", /required/],
    ["   ", undefined, /required/],
    ["packam.example", "development", /absolute URL/],
    ["/settings", "development", /absolute URL/],
    ["ftp://packam.example", "development", /https:\/\//],
    ["http://packam.example", "production", /HTTPS in production/],
    ["https://admin:secret-value@packam.example", "production", /username or password/],
  ];
  for (const [value, nodeEnv, pattern] of cases) {
    assert.throws(
      () => parseAppUrl(value, nodeEnv),
      (error) => error instanceof AppUrlConfigError && error.name === "AppUrlConfigError" && pattern.test(error.message) && !error.message.includes("secret-value"),
      String(value),
    );
  }
});

test("links are built on APP_URL's origin, from internal paths only", () => {
  const base = parseAppUrl("https://packam.example", "production");
  assert.equal(buildAppUrl(base, "/reset-password?token=abc_DEF-123"), "https://packam.example/reset-password?token=abc_DEF-123");
  assert.equal(buildAppUrl(base, "/settings?email=changed#email"), "https://packam.example/settings?email=changed#email");
  assert.equal(buildAppUrl(parseAppUrl("https://packam.example/ignored/", "production"), "/verify-email"), "https://packam.example/verify-email", "same rule as the payment links");
  for (const path of ["https://evil.example/reset-password", "//evil.example/x", "/\\evil.example", "settings", "", "javascript:alert(1)"]) {
    assert.throws(() => buildAppUrl(base, path), /internal path/, path);
  }
});

test("appUrl reads APP_URL when it is called", () => {
  const saved = process.env.APP_URL;
  try {
    process.env.APP_URL = "https://packam.example";
    assert.equal(appUrl("/verify-email?token=x"), "https://packam.example/verify-email?token=x");
    delete process.env.APP_URL;
    assert.throws(() => appUrl("/settings"), AppUrlConfigError);
  } finally {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  }
});
