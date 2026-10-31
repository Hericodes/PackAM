import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidEmail, maskEmail, nameProblem, normaliseEmail, normaliseName, normalisePhone, phoneProblem } from "./validation";

test("emails are trimmed and lowercased, as they are stored", () => {
  assert.equal(normaliseEmail("  Ada.Okafor@Uni.EDU "), "ada.okafor@uni.edu");
  for (const junk of [undefined, null, 42, ["ada@uni.edu"]]) assert.equal(normaliseEmail(junk), "");
});

test("a sane email shape is required, without rejecting real addresses", () => {
  for (const ok of ["ada@uni.edu", "ada.okafor+packam@student.uni.edu.ng", "o'neil@example.com", "a@b.co", "x_y-z@sub-domain.example.org", "Ada@Uni.EDU", "user@xn--80ak6aa92e.com"]) {
    assert.equal(isValidEmail(ok), true, ok);
  }
  const bad = [
    "", "ada", "ada@", "@uni.edu", "ada@uni", "ada@@uni.edu", "ada@uni..edu", "ada@-uni.edu", "ada@uni-.edu", "ada @uni.edu",
    ".ada@uni.edu", "ada.@uni.edu", "a..da@uni.edu", "ada@uni.e", "ada@uni.123", "08012345678", "ada@uni.edu.", "ada<b>@uni.edu",
    `${"a".repeat(65)}@uni.edu`, `a@${"b".repeat(64)}.com`, `a@${Array.from({ length: 5 }, () => "b".repeat(60)).join(".")}.com`,
  ];
  for (const value of bad) assert.equal(isValidEmail(value), false, value);
  for (const junk of [undefined, null, 42]) assert.equal(isValidEmail(junk), false);
});

test("names: spaces collapsed; letters in any alphabet plus apostrophes, hyphens and dots; 1–60 characters", () => {
  assert.equal(normaliseName("  Ada   Okafor-Bello \n"), "Ada Okafor-Bello");
  assert.equal(normaliseName(7), "");
  for (const ok of ["Ada", "Chí-Ọ̀má", "O’Brien", "O'Neil", "St. John", "Zoë", "José María", "Ọlálékan", "李", "a".repeat(60)]) {
    assert.equal(nameProblem(ok), null, ok);
  }
  assert.equal(nameProblem("", "first name"), "Enter your first name.");
  assert.equal(nameProblem("   ", "last name"), "Enter your last name.");
  assert.equal(nameProblem(undefined), "Enter your name.");
  assert.match(nameProblem("Ada1") ?? "", /only letters, spaces, apostrophes, hyphens and dots/);
  assert.match(nameProblem("<script>") ?? "", /only letters/);
  assert.match(nameProblem("Ada_Okafor") ?? "", /only letters/);
  assert.match(nameProblem("a".repeat(61), "first name") ?? "", /first name to 60 characters/);
  assert.match(nameProblem("-'.") ?? "", /at least one letter/);
});

test("phones are only trimmed, so stored numbers keep matching, and need 7–20 characters with 7+ digits", () => {
  assert.equal(normalisePhone("  0801 234 5678 "), "0801 234 5678");
  assert.equal(normalisePhone(8012345678), "");
  for (const ok of ["08000000101", "+2348012345678", "0801 234 5678", "(0801) 234-5678", "1234567", " 08012345678 "]) {
    assert.equal(phoneProblem(ok), null, ok);
  }
  assert.equal(phoneProblem(""), "Enter your phone number.");
  assert.equal(phoneProblem(null), "Enter your phone number.");
  for (const bad of ["123456", "080-12", "080123456789012345678", "phone 0801234567", "0801+2345678", "++2348012345678", "+()- ()- ()- ()-", "0801.234.5678", "ada@uni.edu"]) {
    assert.equal(phoneProblem(bad), "Enter a valid phone number, like 08012345678.", bad);
  }
});

test("masked emails show the first character and the domain, never the length", () => {
  assert.equal(maskEmail("ada@uni.edu"), "a••@uni.edu");
  assert.equal(maskEmail("ada.okafor.long@gmail.com"), "a••@gmail.com");
  assert.equal(maskEmail("x@uni.edu"), "x••@uni.edu");
  assert.equal(maskEmail("no-at-sign"), "n••");
  assert.equal(maskEmail(""), "••");
});
