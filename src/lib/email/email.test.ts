import assert from "node:assert/strict";
import { test } from "node:test";
import { EmailConfigError, parseEmailConfig } from "./config";
import {
  accountDeletedNotice, confirmEmailChange, emailChangeRequestedNotice, emailChangedNotice, escapeHtml,
  passwordChangedNotice, resetPassword, verifyEmail,
} from "./templates";

const RESEND = { RESEND_API_KEY: "re_test_123456789", EMAIL_FROM: "PackAM <no-reply@mail.packam.example>" };

test("email config: Resend needs a key and a sender; with nothing set, email is simply not configured", () => {
  assert.deepEqual(parseEmailConfig({}), { mode: "none" });
  assert.deepEqual(parseEmailConfig({ NODE_ENV: "production" }), { mode: "none" });
  assert.deepEqual(parseEmailConfig({ ...RESEND, NODE_ENV: "production" }), { mode: "resend", apiKey: "re_test_123456789", from: "PackAM <no-reply@mail.packam.example>" });
  assert.deepEqual(
    parseEmailConfig({ RESEND_API_KEY: " re_x ", EMAIL_FROM: " no-reply@packam.example ", EMAIL_TRANSPORT: "Resend" }),
    { mode: "resend", apiKey: "re_x", from: "no-reply@packam.example" },
  );
});

test("email config: half-configured setups fail loudly, naming the variable but never its value", () => {
  const cases: Array<[Record<string, string>, RegExp]> = [
    [{ RESEND_API_KEY: "re_secret_value" }, /EMAIL_FROM is missing/],
    [{ EMAIL_FROM: "no-reply@packam.example" }, /RESEND_API_KEY is missing/],
    [{ EMAIL_TRANSPORT: "resend" }, /needs RESEND_API_KEY and EMAIL_FROM/],
    [{ EMAIL_TRANSPORT: "smtp", ...RESEND }, /EMAIL_TRANSPORT must be/],
    [{ EMAIL_TRANSPORT: "file" }, /needs EMAIL_FILE_DIR/],
    [{ EMAIL_FILE_DIR: "./mail" }, /EMAIL_TRANSPORT isn’t "file"/],
    [{ ...RESEND, EMAIL_FROM: "PackAM" }, /EMAIL_FROM must be an address/],
    [{ ...RESEND, EMAIL_FROM: "PackAM <not-an-address>" }, /EMAIL_FROM must be an address/],
    [{ ...RESEND, RESEND_API_KEY: "\"re_secret_value\"" }, /without spaces or quotes/],
    [{ ...RESEND, RESEND_API_KEY: "Bearer re_secret_value" }, /without spaces or quotes/],
  ];
  for (const [env, pattern] of cases) {
    assert.throws(
      () => parseEmailConfig(env),
      (error) => error instanceof EmailConfigError && error.name === "EmailConfigError" && pattern.test(error.message) && !error.message.includes("secret_value"),
      JSON.stringify(Object.keys(env)),
    );
  }
});

test("email config: the file transport and the test outbox never run in production, and tests never send real mail", () => {
  assert.deepEqual(parseEmailConfig({ EMAIL_TRANSPORT: "file", EMAIL_FILE_DIR: " ./tmp/mail " }), { mode: "file", dir: "./tmp/mail" });
  assert.throws(() => parseEmailConfig({ EMAIL_TRANSPORT: "file", EMAIL_FILE_DIR: "./tmp/mail", NODE_ENV: "production" }), EmailConfigError);
  assert.deepEqual(parseEmailConfig({ PACKAM_DB_TEST: "1", ...RESEND, EMAIL_TRANSPORT: "file", EMAIL_FILE_DIR: "x" }), { mode: "memory" }, "a provider key in .env is ignored by a test run");
  assert.throws(() => parseEmailConfig({ PACKAM_DB_TEST: "1", NODE_ENV: "production" }), EmailConfigError);
  assert.deepEqual(parseEmailConfig({ PACKAM_DB_TEST: "0" }), { mode: "none" });
});

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const LINK = `https://packam.example/reset-password?token=${TOKEN}&from=email`;

test("templates: subject, plain text and HTML for every email; links appear in both parts, never in the subject", () => {
  const withLinks = [verifyEmail("Ada", LINK), resetPassword("Ada", LINK), confirmEmailChange("Ada", LINK, "ada.new@uni.example")];
  for (const email of withLinks) {
    assert.ok(email.text.includes(`\n${LINK}\n`), "the plain-text link sits on its own line");
    assert.ok(email.html.includes(`href="${LINK.replace("&", "&amp;")}"`), "the HTML link is escaped");
    assert.ok(!email.subject.includes(TOKEN) && !/https?:/.test(email.subject), "no token or link in the subject");
  }
  const notices = [emailChangeRequestedNotice("Ada", "a••@uni.example"), passwordChangedNotice("Ada"), emailChangedNotice("Ada"), accountDeletedNotice("Ada")];
  for (const email of [...withLinks, ...notices]) {
    assert.ok(email.subject.length > 0 && email.subject.length < 80);
    assert.doesNotMatch(email.subject, /@/, "no address in the subject");
    assert.match(email.text, /^Hi Ada,\n\n/);
    assert.match(email.text, /PackAM\n$/);
    assert.match(email.html, /^<!doctype html>/);
    assert.match(email.html, /Pack<span style="color:#875a00;">AM<\/span>/, "the PackAM wordmark");
    assert.match(email.html, /content="light only"/);
    assert.ok(!email.text.includes("<"), "the plain-text part has no markup");
  }
  for (const email of notices) assert.doesNotMatch(email.html, /href=/, "notices carry no links");
});

test("templates: the copy states each link's lifetime and what happens if it wasn't you", () => {
  assert.match(verifyEmail("Ada", LINK).text, /24 hours/);
  assert.match(confirmEmailChange("Ada", LINK, "ada.new@uni.example").text, /24 hours/);
  assert.match(resetPassword("Ada", LINK).text, /30 minutes/);
  assert.match(resetPassword("Ada", LINK).text, /your password won’t change/);
  assert.match(confirmEmailChange("Ada", LINK, "ada.new@uni.example").text, /ada\.new@uni\.example/, "the new address is the reader's own");
  assert.match(emailChangeRequestedNotice("Ada", "a••@uni.example").text, /a••@uni\.example/);
  assert.match(passwordChangedNotice("Ada").text, /Forgot password\?/);
  assert.match(accountDeletedNotice("Ada").text, /past orders, payments, refunds and print jobs/);
});

test("templates: names and addresses are escaped in HTML and kept to one line in plain text", () => {
  const email = confirmEmailChange("<b>Ada</b> & \"Co\"\nOkafor", LINK, "x\"<b>@uni.example");
  assert.ok(!email.html.includes("<b>"), "markup from stored values never reaches the HTML");
  assert.ok(email.html.includes("Hi &lt;b&gt;Ada&lt;/b&gt; &amp; &quot;Co&quot; Okafor,"));
  assert.ok(email.html.includes("x&quot;&lt;b&gt;@uni.example"));
  assert.match(email.text, /^Hi <b>Ada<\/b> & "Co" Okafor,\n\n/, "a newline in a name can't start a new line of text");
  assert.match(verifyEmail(null, LINK).text, /^Hi there,/);
  assert.match(verifyEmail("   ", LINK).text, /^Hi there,/);
  assert.match(verifyEmail("A".repeat(200), LINK).text, new RegExp(`^Hi ${"A".repeat(60)},`), "very long names are cut short");
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("templates refuse anything but an absolute http(s) link", () => {
  for (const bad of ["javascript:alert(1)", "/reset-password?token=x", "", "mailto:ada@uni.example", "data:text/html,hi"]) {
    assert.throws(() => resetPassword("Ada", bad), /absolute http\(s\) URLs/, bad);
  }
});
