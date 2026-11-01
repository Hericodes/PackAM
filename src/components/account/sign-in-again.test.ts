import assert from "node:assert/strict";
import { test } from "node:test";
import { reauthEmail } from "./sign-in-again";

test("signing back in uses the account's email as the server answered it, else the one on the page", () => {
  // The page was rendered before a new email was confirmed in another tab.
  assert.equal(reauthEmail({ ok: true, reauth: true, email: "ada.new@uni.example" }, "ada.old@uni.example"), "ada.new@uni.example");
  assert.equal(reauthEmail({ ok: true, reauth: true, email: "  ada.new@uni.example " }, "ada.old@uni.example"), "ada.new@uni.example");
  for (const answer of [{ ok: true, reauth: true }, { email: "" }, { email: "   " }, { email: 42 }, null, undefined, "ada.new@uni.example", ["ada.new@uni.example"]]) {
    assert.equal(reauthEmail(answer, "ada.old@uni.example"), "ada.old@uni.example", JSON.stringify(answer));
  }
});
