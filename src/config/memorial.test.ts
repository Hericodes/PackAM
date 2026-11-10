import assert from "node:assert/strict";
import { test } from "node:test";
import { MEMORIAL_PATH, memorialActive, memorialHref } from "./memorial";
import { ORDERING_CLOSURES } from "./ordering-closures";
import { resolvePostLoginDestination } from "../lib/auth-redirect";

const lagos = (iso: string) => Date.parse(`${iso}+01:00`);

test("the memorial is up from Tuesday 10 November until the end of Wednesday 11 November, campus time", () => {
  assert.equal(memorialActive(lagos("2026-11-09T23:59:59")), false);
  assert.equal(memorialActive(lagos("2026-11-10T00:00:00")), true);
  assert.equal(memorialActive(lagos("2026-11-11T23:59:59")), true);
  assert.equal(memorialActive(lagos("2026-11-12T00:00:00")), false, "Thursday: back to normal");
});

test("the memorial link carries where the student was going, and the page only continues to safe student pages", () => {
  assert.equal(memorialHref("/"), MEMORIAL_PATH);
  assert.equal(memorialHref("/food?tab=all"), "/in-memory?next=%2Ffood%3Ftab%3Dall");
  assert.equal(resolvePostLoginDestination("STUDENT", "/food?tab=all"), "/food?tab=all");
  assert.equal(resolvePostLoginDestination("STUDENT", "https://evil.example/"), "/", "never off-site");
  assert.equal(resolvePostLoginDestination("STUDENT", MEMORIAL_PATH), "/", "the gate never sends anyone from the memorial page to itself");
});

test("no ordering on 11 November", () => {
  assert.ok(ORDERING_CLOSURES.some((closure) => closure.date === "2026-11-11"));
});
