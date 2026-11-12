import assert from "node:assert/strict";
import { test } from "node:test";
import { SUPER_ADMIN_PATHS, adminLevelFor, adminLevelsConfigured, canManageAdmins, canOpenAdminPath, isConfiguredSuperAdmin, parseDemotionRole, parseSuperAdminEmails } from "./admin-levels";

test("SUPER_ADMIN_EMAILS: commas, semicolons or spaces; lowercased; anything else ignored", () => {
  assert.deepEqual(parseSuperAdminEmails(" Owner@PackAM.app, second@uni.edu ;third@x.co  fourth@y.ng"), ["owner@packam.app", "second@uni.edu", "third@x.co", "fourth@y.ng"]);
  assert.deepEqual(parseSuperAdminEmails("not-an-email, , @x.com, a@b"), []);
  assert.deepEqual(parseSuperAdminEmails(undefined), []);
  assert.deepEqual(parseSuperAdminEmails("a@b.co, A@B.CO"), ["a@b.co"], "no duplicates");
});

test("levels: a listed email is the super admin; every other admin is a normal admin", () => {
  const supers = parseSuperAdminEmails("owner@packam.app");
  assert.equal(adminLevelsConfigured(supers), true);
  assert.equal(adminLevelFor("Owner@PackAM.app ", supers), "super");
  assert.equal(adminLevelFor("helper@packam.app", supers), "admin");
  assert.equal(adminLevelFor(null, supers), "admin");
  assert.equal(isConfiguredSuperAdmin("owner@packam.app", supers), true);
  assert.equal(isConfiguredSuperAdmin("helper@packam.app", supers), false);
});

test("until SUPER_ADMIN_EMAILS is set, every admin keeps full access but nobody can add or remove admins", () => {
  assert.equal(adminLevelsConfigured([]), false);
  assert.equal(adminLevelFor("anyone@packam.app", []), "super");
  assert.equal(isConfiguredSuperAdmin("anyone@packam.app", []), false);
  assert.equal(canManageAdmins("super", []), false);
  assert.equal(canManageAdmins("super", ["owner@packam.app"]), true);
  assert.equal(canManageAdmins("admin", ["owner@packam.app"]), false);
});

test("normal admins can't open Finance, Analytics, the Audit log or Admins; everything else stays open", () => {
  assert.deepEqual([...SUPER_ADMIN_PATHS], ["/admin/finance", "/admin/analytics", "/admin/audit", "/admin/admins"]);
  for (const path of ["/admin/finance", "/admin/finance?from=2026-11-01", "/admin/analytics", "/admin/audit", "/admin/admins"]) {
    assert.equal(canOpenAdminPath("admin", path), false, path);
    assert.equal(canOpenAdminPath("super", path), true, path);
  }
  for (const path of ["/admin", "/admin/orders", "/admin/payments", "/admin/promo-codes", "/admin/delivery-tiers", "/admin/emails", "/admin/runners", "/admin/auditors"]) {
    assert.equal(canOpenAdminPath("admin", path), true, path);
  }
});

test("a removed admin goes back to student or runner, nothing else", () => {
  assert.equal(parseDemotionRole("STUDENT"), "STUDENT");
  assert.equal(parseDemotionRole("RUNNER"), "RUNNER");
  assert.equal(parseDemotionRole("ADMIN"), null);
  assert.equal(parseDemotionRole(undefined), null);
});
