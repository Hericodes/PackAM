import assert from "node:assert/strict";
import { test } from "node:test";
import { assessTestDatabaseUrl } from "./test-database-guard";

const appPooled = "postgresql://owner:secret@ep-example-app-123-pooler.region.example-neon.test/neondb?sslmode=require";
const appDirect = "postgresql://owner:secret@ep-example-app-123.region.example-neon.test/neondb?sslmode=require";

test("an unset test database URL is not usable", () => {
  assert.equal(assessTestDatabaseUrl(undefined, [appPooled]).ok, false);
});

test("the application database is refused however its URL is written", () => {
  const variants = [
    appPooled,
    appDirect,
    `${appDirect}&connect_timeout=10`,
    "postgres://other-user:other@EP-EXAMPLE-APP-123-POOLER.region.example-neon.test:5432/neondb",
  ];
  for (const variant of variants) {
    const verdict = assessTestDatabaseUrl(variant, [appPooled, appDirect], { disposableConfirmed: true });
    assert.equal(verdict.ok, false, variant);
  }
});

test("refusal reasons never echo credentials", () => {
  const verdict = assessTestDatabaseUrl(appDirect, [appPooled, appDirect]);
  assert.equal(verdict.ok, false);
  assert.doesNotMatch(verdict.ok ? "" : verdict.reason, /secret|owner|example-neon|ep-example/);
});

test("a database is only accepted when it is clearly disposable", () => {
  assert.equal(assessTestDatabaseUrl("postgresql://u:p@127.0.0.1:54329/packam_test", [appPooled, appDirect]).ok, true);
  // A separate database without "test" in its name needs explicit confirmation.
  const branch = "postgresql://u:p@ep-other-branch-999.region.example-neon.test/neondb";
  assert.equal(assessTestDatabaseUrl(branch, [appPooled, appDirect]).ok, false);
  assert.equal(assessTestDatabaseUrl(branch, [appPooled, appDirect], { disposableConfirmed: true }).ok, true);
});

test("non-postgres and malformed URLs are refused", () => {
  assert.equal(assessTestDatabaseUrl("mysql://u:p@localhost/packam_test", []).ok, false);
  assert.equal(assessTestDatabaseUrl("not a url", []).ok, false);
});
