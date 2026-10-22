/**
 * Runner profile lookup and set-up against a disposable database, through the real routes.
 * Reproduces the production failure: a RUNNER account with no RunnerProfile (role changed directly
 * in the database) used to get "Runner profile not found." on the dashboard.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import { callRoute, cleanupTestData, createTestUser, dbTestSkip as skip, signInAs, testDb } from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  availability: typeof import("../../app/api/runner/availability/route");
  missions: typeof import("../../app/api/runner/missions/route");
  adminRunner: typeof import("../../app/api/admin/runners/[id]/route");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [availability, missions, adminRunner] = await Promise.all([
    import("../../app/api/runner/availability/route"),
    import("../../app/api/runner/missions/route"),
    import("../../app/api/admin/runners/[id]/route"),
  ]);
  app = { db, availability, missions, adminRunner };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;

/** A student account whose role was later changed to RUNNER directly in the database (no RunnerProfile). */
async function profilelessRunner() {
  const student = await createTestUser("STUDENT");
  await app.db.user.update({ where: { id: student.userId }, data: { role: "RUNNER" } });
  return { ...student, role: "RUNNER" as const };
}

function verify(admin: User | null, userId: string, action: "verify" | "unverify") {
  signInAs(admin);
  return callRoute(app.adminRunner.POST, { method: "POST", params: { id: userId }, body: { action } });
}

test("a runner account without a profile sees set-up pending instead of 'Runner profile not found'", { skip }, async () => {
  const runner = await profilelessRunner();
  signInAs(runner);
  const status = await callRoute(app.availability.GET);
  assert.equal(status.status, 200, "previously 404 'Runner profile not found.'");
  assert.deepEqual(status.json, { isAvailable: false, isVerified: false, profileMissing: true });
  assert.equal(await app.db.runnerProfile.count({ where: { userId: runner.userId } }), 0, "the lookup never creates a profile");
  signInAs(runner);
  assert.equal((await callRoute(app.missions.GET)).status, 403, "no missions until set up and verified");
});

test("a set-up, verified runner's profile lookup succeeds", { skip }, async () => {
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  signInAs(runner);
  const status = await callRoute(app.availability.GET);
  assert.equal(status.status, 200);
  assert.deepEqual(status.json, { isAvailable: false, isVerified: true, profileMissing: false });
  signInAs(runner);
  assert.equal((await callRoute(app.missions.GET)).status, 200);
});

test("operations sets up and verifies a profile-less runner exactly once, audited", { skip }, async () => {
  const { db } = app;
  const admin = await createTestUser("ADMIN");
  const runner = await profilelessRunner();

  const clicks = await Promise.all([verify(admin, runner.userId, "verify"), verify(admin, runner.userId, "verify"), verify(admin, runner.userId, "verify")]);
  for (const click of clicks) assert.equal(click.status, 200, JSON.stringify(click.json));
  assert.equal(await db.runnerProfile.count({ where: { userId: runner.userId } }), 1, "never a duplicate profile");
  assert.equal(clicks.filter((c) => c.json.kind === "UPDATED" && c.json.profileCreated === true).length, 1);
  const profile = await db.runnerProfile.findUniqueOrThrow({ where: { userId: runner.userId } });
  assert.deepEqual({ verified: profile.isVerified, available: profile.isAvailable }, { verified: true, available: false }, "verified but not auto-available");
  assert.equal(await db.auditLog.count({ where: { action: "RUNNER_VERIFIED", resourceId: runner.userId, actorId: admin.userId } }), 1);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: runner.userId } })).role, "RUNNER", "the role is never changed");

  signInAs(runner);
  assert.deepEqual((await callRoute(app.availability.GET)).json, { isAvailable: false, isVerified: true, profileMissing: false });
});

test("un-verifying takes the runner offline; only admins can change verification; non-runners are refused", { skip }, async () => {
  const { db } = app;
  const admin = await createTestUser("ADMIN");
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: true });
  const student = await createTestUser("STUDENT");

  assert.equal((await verify(null, runner.userId, "unverify")).status, 403);
  assert.equal((await verify(runner, runner.userId, "unverify")).status, 403, "a runner can't change their own verification");
  assert.equal((await verify(student, runner.userId, "unverify")).status, 403);

  assert.equal((await verify(admin, runner.userId, "unverify")).status, 200);
  const profile = await db.runnerProfile.findUniqueOrThrow({ where: { userId: runner.userId } });
  assert.deepEqual({ verified: profile.isVerified, available: profile.isAvailable }, { verified: false, available: false });

  const notRunner = await verify(admin, student.userId, "verify");
  assert.equal(notRunner.status, 409, "a student account is never turned into a runner");
  assert.equal(await db.runnerProfile.count({ where: { userId: student.userId } }), 0);
  assert.equal((await verify(admin, "no-such-user", "verify")).status, 404);
});
