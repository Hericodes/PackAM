import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyEmailAnswer, verifyEmailCopy, verifyEmailLinks, verifyEmailOutcome, type VerifyEmailOutcome } from "./verify-email";

const OUTCOMES: VerifyEmailOutcome[] = ["verified", "already", "expired", "used", "invalid", "error", "waiting"];
const SIGNED_OUT = { signedIn: false, home: "/" };

test("the confirm button's answer is read defensively: only the five known statuses, anything else is an error", () => {
  for (const status of ["verified", "already", "expired", "used", "invalid"] as const) assert.equal(verifyEmailAnswer({ status }), status);
  for (const junk of [{ status: "error" }, { status: "VERIFIED" }, { status: "__proto__" }, { error: "Blocked", code: "CROSS_SITE_REQUEST" }, {}, null, undefined, "verified", ["verified"]]) {
    assert.equal(verifyEmailAnswer(junk), "error", JSON.stringify(junk));
  }
});

test("a ?status= from an older link names its outcome; anything else is the waiting page", () => {
  for (const status of ["verified", "already", "expired", "used", "invalid", "error"]) assert.equal(verifyEmailOutcome(status), status);
  for (const junk of [undefined, "", "VERIFIED", "waiting", "__proto__", "toString"]) assert.equal(verifyEmailOutcome(junk), "waiting", String(junk));
});

test("every outcome has a heading and a message; confirmed ones are successes, and every failure says what to do", () => {
  for (const outcome of OUTCOMES) {
    const copy = verifyEmailCopy(outcome);
    assert.ok(copy.title && copy.message, outcome);
    assert.doesNotMatch(`${copy.title} ${copy.message}`, /[{}<>]|undefined|null/, `${outcome}: plain words only`);
    if (outcome === "verified" || outcome === "already") assert.equal(copy.tone, "success", outcome);
    else if (outcome === "waiting") assert.equal(copy.tone, "info");
    else assert.equal(copy.tone, "error", outcome);
  }
  assert.match(verifyEmailCopy("expired").message, /24 hours/);
  assert.match(verifyEmailCopy("error").message, /hasn’t been used/, "an error leaves the link working");
  assert.match(verifyEmailCopy("waiting").message, /out of the address bar/, "a refresh explains why the link is needed again");
});

test("next steps: signed in, home or Settings first; signed out, log in (to Settings for a new link) or the home page", () => {
  const runner = { signedIn: true, home: "/runner" };
  assert.deepEqual(verifyEmailLinks("verified", runner), [{ href: "/runner", label: "Continue to PackAM" }, { href: "/settings", label: "Go to Settings" }]);
  assert.deepEqual(verifyEmailLinks("expired", runner), [{ href: "/settings", label: "Send a new link from Settings" }, { href: "/runner", label: "Continue to PackAM" }]);
  assert.deepEqual(verifyEmailLinks("error", runner), [{ href: "/runner", label: "Continue to PackAM" }]);
  assert.deepEqual(verifyEmailLinks("already", SIGNED_OUT), [{ href: "/login?verified=1", label: "Log in" }]);
  assert.deepEqual(verifyEmailLinks("used", SIGNED_OUT), [
    { href: "/login?callbackUrl=%2Fsettings", label: "Log in to send a new link" },
    { href: "/", label: "Back to PackAM" },
  ]);
  assert.deepEqual(verifyEmailLinks("error", SIGNED_OUT), [{ href: "/", label: "Back to PackAM" }]);
  for (const outcome of OUTCOMES) {
    for (const viewer of [runner, SIGNED_OUT]) {
      for (const link of verifyEmailLinks(outcome, viewer)) assert.match(link.href, /^\/(?!\/)/, "same-site paths only");
    }
  }
});
