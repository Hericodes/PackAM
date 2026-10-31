import assert from "node:assert/strict";
import { test } from "node:test";
import { PASSWORD_MAX_BYTES, passwordProblem, passwordRules, passwordStrength } from "./password-policy";
import { hashToken, isWellFormedToken, newToken } from "./tokens";
import { LOGO_SIZE, PARCEL_DROP_POINT, PARCEL_GRIP_POINT, PARCEL_POLYGON, gripOrigin, logoPointInPage, logoWithoutParcelMask, parcelClipPath } from "../../components/auth/parcel-geometry";

test("passwords: length, mix, common and personal rules, as the checklist shows them", () => {
  assert.equal(passwordProblem("Campus-run-42"), null);
  assert.match(passwordProblem("short1") ?? "", /at least 8/);
  assert.match(passwordProblem("onlyletters") ?? "", /letter and a number or symbol/);
  assert.match(passwordProblem("12345678") ?? "", /letter and a number or symbol/);
  assert.match(passwordProblem("Password123") ?? "", /too common/);
  assert.match(passwordProblem("aaaaaaaa1"[0].repeat(9)) ?? "", /letter and a number|too common/);
  assert.match(passwordProblem("ada.okafor99", { email: "ada.okafor@uni.edu" }) ?? "", /name or email/);
  assert.match(passwordProblem("Okafor-2026!", { names: ["Ada", "Okafor"] }) ?? "", /name or email/);
  assert.match(passwordProblem(" padded-pass1") ?? "", /spaces/);
  assert.match(passwordProblem("é".repeat(37) + "1") ?? "", /shorter password/, "bcrypt reads only 72 bytes");
  assert.equal(passwordProblem("x".repeat(PASSWORD_MAX_BYTES - 1) + "1"), null);
  for (const bad of [undefined, null, 12345678, ""]) assert.equal(passwordProblem(bad), "Enter a password.");
  const rules = passwordRules("Campus-run-42");
  assert.ok(rules.every((rule) => rule.met));
  assert.deepEqual(rules.map((rule) => rule.id), ["length", "mix", "common", "personal"]);
});

test("password strength rises with length and variety; common or patterned stays weak", () => {
  assert.equal(passwordStrength("").score, 0);
  assert.equal(passwordStrength("password1").label, "Weak");
  assert.ok(passwordStrength("abc12345x").score <= 2);
  assert.ok(passwordStrength("Campus-run-42").score >= 3);
  assert.equal(passwordStrength("Tall-Mango-Bicycle-91").score, 4);
});

test("tokens: 256-bit url-safe, only the hash is stored, junk is refused before any lookup", () => {
  const a = newToken(); const b = newToken();
  assert.notEqual(a, b);
  assert.ok(isWellFormedToken(a));
  assert.equal(hashToken(a), hashToken(a));
  assert.match(hashToken(a), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(a), a);
  for (const bad of ["", "x", a + "=", a.slice(1), `${a.slice(0, 42)}!`, null, 42]) assert.equal(isWellFormedToken(bad), false);
});

test("parcel geometry stays inside the logo and maps to page coordinates", () => {
  for (const [x, y] of [...PARCEL_POLYGON, PARCEL_DROP_POINT, PARCEL_GRIP_POINT]) assert.ok(x > 0 && x < LOGO_SIZE && y > 0 && y < LOGO_SIZE);
  assert.match(parcelClipPath(), /^polygon\((\d+\.\d{2}% \d+\.\d{2}%, ){20}\d+\.\d{2}% \d+\.\d{2}%\)$/);
  assert.match(logoWithoutParcelMask(), /^url\("data:image\/svg\+xml,/);
  assert.equal(gripOrigin(), "65.00% 30.00%");
  assert.deepEqual(logoPointInPage({ left: 100, top: 50, width: 250, height: 250 }, PARCEL_DROP_POINT), { x: 100 + 191, y: 50 + 57 });
});
