import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmEmailAnswer, confirmEmailCopy, confirmEmailLinks, type ConfirmEmailOutcome } from "./confirm-email";

const OUTCOMES: ConfirmEmailOutcome[] = ["changed", "invalid", "expired", "used", "taken", "missing", "unavailable"];
const SIGNED_OUT = { signedIn: false, home: "/" };

test("the confirm button's answer is read defensively: only the five known statuses, anything else is an error", () => {
  for (const status of ["changed", "invalid", "expired", "used", "taken"] as const) assert.equal(confirmEmailAnswer({ status }), status);
  for (const junk of [{ status: "error" }, { status: "CHANGED" }, { status: "__proto__" }, { error: "Blocked", code: "CROSS_SITE_REQUEST" }, {}, null, undefined, "changed", ["changed"]]) {
    assert.equal(confirmEmailAnswer(junk), "error", JSON.stringify(junk));
  }
});

test("every outcome has a heading and a message; only a change is a success, and every failure says the email hasn't changed", () => {
  for (const outcome of OUTCOMES) {
    const copy = confirmEmailCopy(outcome);
    assert.ok(copy.title && copy.message, outcome);
    assert.doesNotMatch(`${copy.title} ${copy.message}`, /[{}<>]|undefined|null/, `${outcome}: plain words only`);
    if (outcome === "changed") assert.equal(copy.tone, "success");
    else if (outcome === "missing") assert.equal(copy.tone, "info");
    else {
      assert.equal(copy.tone, "error", outcome);
      assert.match(copy.message, /hasn’t changed/, `${outcome}: says nothing changed`);
    }
  }
  assert.match(confirmEmailCopy("changed", "a••@uni.example").message, /a••@uni\.example/, "the new address, masked");
  assert.match(confirmEmailCopy("changed").message, /your new email/);
  assert.match(confirmEmailCopy("expired").message, /24 hours/);
  assert.match(confirmEmailCopy("missing").message, /out of the address bar/, "a refresh explains why the link is needed again");
});

test("next steps: signed in, Settings and home; signed out, log in (with the banner after a change) and the home page", () => {
  for (const outcome of OUTCOMES) {
    assert.deepEqual(confirmEmailLinks(outcome, { signedIn: true, home: "/runner" }), [
      { href: "/settings", label: "Go to Settings" },
      { href: "/runner", label: "Continue to PackAM" },
    ], outcome);
  }
  assert.deepEqual(confirmEmailLinks("changed", SIGNED_OUT), [{ href: "/login?emailChanged=1", label: "Log in" }]);
  for (const outcome of OUTCOMES.filter((value) => value !== "changed")) {
    assert.deepEqual(confirmEmailLinks(outcome, SIGNED_OUT), [
      { href: "/login?callbackUrl=%2Fsettings", label: "Log in" },
      { href: "/", label: "Back to PackAM" },
    ], outcome);
  }
});
