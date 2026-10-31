/**
 * Account settings through the real routes against a disposable database: reading the account, changing names,
 * changing email (request, confirm, cancel), changing password, signing out devices, and deleting a student
 * account, which anonymises it in place and keeps every order, payment and audit row. Emails land in the
 * in-memory test outbox; nothing is sent. Run with `npm run test:db` (see src/test-support/db-harness.ts for the
 * safety rules).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  dbTestSkip as skip,
  setTestPassword,
  signInAs,
  testClientIp,
  testDb,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";
import type { OrderStatus, PaymentStatus } from "@prisma/client";
import { deletedAccountEmail, deletionBlockerMessage, type DeletionBlockerKind } from "./deletion-policy";
import { maskEmail } from "./validation";

// No Cloudinary credentials in tests: deleting an account must never reach real document storage.
process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "packam-test-cloud";
delete process.env.CLOUDINARY_API_SECRET;

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  account: typeof import("../../app/api/account/route");
  profile: typeof import("../../app/api/account/profile/route");
  email: typeof import("../../app/api/account/email/route");
  confirm: typeof import("../../app/api/account/email/confirm/route");
  password: typeof import("../../app/api/account/password/route");
  sessions: typeof import("../../app/api/account/sessions/route");
  remove: typeof import("../../app/api/account/delete/route");
  mail: typeof import("../email");
  tokens: typeof import("./account-tokens");
  deletion: typeof import("./deletion");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [account, profile, email, confirm, password, sessions, remove, mail, tokens, deletion] = await Promise.all([
    import("../../app/api/account/route"),
    import("../../app/api/account/profile/route"),
    import("../../app/api/account/email/route"),
    import("../../app/api/account/email/confirm/route"),
    import("../../app/api/account/password/route"),
    import("../../app/api/account/sessions/route"),
    import("../../app/api/account/delete/route"),
    import("../email"),
    import("./account-tokens"),
    import("./deletion"),
  ]);
  app = { db, account, profile, email, confirm, password, sessions, remove, mail, tokens, deletion };
});
after(cleanupTestData);

type User = Awaited<ReturnType<typeof createTestUser>>;
type Handler = Parameters<typeof callRoute>[0];
type CallOptions = NonNullable<Parameters<typeof callRoute>[1]>;
type Blocker = { kind: string; message: string; count: number };

const PASSWORD = "Old-campus-pass-1";
const NEW_PASSWORD = "Fresh-campus-77";
const HOUR = 60 * 60 * 1000;

/** A request from PackAM's own page as `user` (null = signed out), from its own client address. */
function call(user: User | null, handler: Handler, options: CallOptions = {}) {
  signInAs(user);
  return callRoute(handler, { ...options, headers: { "x-real-ip": testClientIp(), ...options.headers } });
}

async function userWithPassword(role: "STUDENT" | "RUNNER" | "ADMIN" = "STUDENT") {
  const user = await createTestUser(role, role === "RUNNER" ? { isVerified: true, isAvailable: false } : undefined);
  await setTestPassword(user.userId, PASSWORD);
  return user;
}

const account = (userId: string) => app.db.user.findUniqueOrThrow({ where: { id: userId } });
const freshEmail = (label: string) => `${label}-${randomUUID()}@packam.test`;
const freshPhone = () => `080${String(parseInt(randomUUID().replace(/-/g, "").slice(0, 10), 16) % 100_000_000).padStart(8, "0")}`;
const mailTo = (address: string) => app.mail.testOutbox().filter((message) => message.to === address);
const confirmLink = (token: string) => `http://packam.test/api/account/email/confirm?token=${token}`;
const changeEmail = (user: User, newEmail: string, currentPassword = PASSWORD) =>
  call(user, app.email.POST, { method: "POST", body: { newEmail, currentPassword } });

/** Asks for an email change and returns the link from the confirmation email. */
async function requestChange(user: User, newEmail: string) {
  const response = await changeEmail(user, newEmail);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const link = mailTo(newEmail).at(-1)?.text.match(/http:\/\/packam\.test\/api\/account\/email\/confirm\?token=[A-Za-z0-9_-]{43}/)?.[0];
  assert.ok(link, "the confirmation email carries the link");
  return link;
}

/** Opens an emailed link in a browser signed in as `user` (callRoute drops headers, so the handler is called directly). */
async function openLink(user: User | null, link: string) {
  signInAs(user);
  const response = await app.confirm.GET(new Request(link));
  return { status: response.status, location: response.headers.get("location") };
}

test("every account route needs a signed-in, active account and a same-site JSON request", { skip }, async () => {
  const { db } = app;
  const student = await userWithPassword();
  const before = await account(student.userId);
  const reads: Array<[string, Handler]> = [["GET /api/account", app.account.GET], ["GET /api/account/delete", app.remove.GET]];
  const writes: Array<[string, Handler, string, unknown]> = [
    ["PATCH /api/account/profile", app.profile.PATCH, "PATCH", { firstName: "Ada", lastName: "Okafor" }],
    ["POST /api/account/email", app.email.POST, "POST", { newEmail: freshEmail("guard"), currentPassword: PASSWORD }],
    ["DELETE /api/account/email", app.email.DELETE, "DELETE", undefined],
    ["POST /api/account/password", app.password.POST, "POST", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }],
    ["POST /api/account/sessions", app.sessions.POST, "POST", { action: "all", currentPassword: PASSWORD }],
    ["POST /api/account/delete", app.remove.POST, "POST", { currentPassword: PASSWORD, confirm: "DELETE" }],
  ];

  const otherSites: Array<Record<string, string>> = [{ Origin: "https://evil.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }];

  for (const [name, handler] of reads) assert.equal((await call(null, handler)).status, 401, name);
  for (const [name, handler, method, body] of writes) {
    const signedOut = await call(null, handler, { method, body });
    assert.equal(signedOut.status, 401, name);
    assert.equal(signedOut.json.code, "SIGN_IN_REQUIRED", name);
    for (const headers of otherSites) {
      const crossSite = await call(student, handler, { method, body, headers });
      assert.equal(crossSite.status, 403, `${name} ${JSON.stringify(headers)}`);
      assert.equal(crossSite.json.code, "CROSS_SITE_REQUEST", name);
    }
    if (body !== undefined) {
      const notJson = await call(student, handler, { method, body, headers: { "Content-Type": "text/plain;charset=UTF-8" } });
      assert.equal(notJson.status, 415, name);
      assert.equal(notJson.json.code, "JSON_REQUIRED", name);
    }
  }

  const blockedAccount = await account(student.userId);
  assert.deepEqual(
    [blockedAccount.firstName, blockedAccount.email, blockedAccount.passwordHash, blockedAccount.sessionVersion, blockedAccount.status],
    [before.firstName, before.email, before.passwordHash, before.sessionVersion, "ACTIVE"],
    "refused requests change nothing",
  );
  assert.equal(await db.accountToken.count({ where: { userId: student.userId } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: student.userId } }), 0);

  // PackAM's own pages pass the guard.
  const sameOrigin = await call(student, app.profile.PATCH, { method: "PATCH", body: { firstName: "Ada", lastName: "Okafor" }, headers: { Origin: "http://packam.test", "Sec-Fetch-Site": "same-origin" } });
  assert.equal(sameOrigin.status, 200, JSON.stringify(sameOrigin.json));

  // A suspended account's session is refused everywhere, even before auth.ts would end it.
  const suspended = await userWithPassword();
  await db.user.update({ where: { id: suspended.userId }, data: { status: "SUSPENDED" } });
  for (const [name, handler] of reads) assert.equal((await call(suspended, handler)).status, 401, name);
  for (const [name, handler, method, body] of writes) assert.equal((await call(suspended, handler, { method, body })).status, 401, name);
  assert.equal((await account(suspended.userId)).sessionVersion, 0);
});

test("GET /api/account shows the account, a pending email in full, and whether email works", { skip }, async () => {
  const { db, mail } = app;
  const student = await userWithPassword();
  const phone = freshPhone();
  await db.user.update({ where: { id: student.userId }, data: { phone, lastName: "Okafor" } });
  const me = await account(student.userId);

  const response = await call(student, app.account.GET);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(Object.keys(response.json).sort(), [
    "canDelete", "createdAt", "email", "emailConfigured", "emailVerified", "firstName", "lastName", "passwordChangedAt", "pendingEmail",
    "pendingEmailExpiresAt", "phone", "role",
  ]);
  assert.deepEqual(
    { ...response.json, createdAt: undefined },
    { firstName: me.firstName, lastName: "Okafor", email: me.email, phone, emailVerified: false, createdAt: undefined, role: "STUDENT", pendingEmail: null, pendingEmailExpiresAt: null, passwordChangedAt: null, emailConfigured: true, canDelete: true },
  );
  assert.equal(response.json.createdAt, me.createdAt.toISOString());

  const newEmail = freshEmail("pending");
  await requestChange(student, newEmail);
  const pending = await call(student, app.account.GET);
  assert.equal(pending.json.pendingEmail, newEmail, "the owner sees the whole pending address");
  const expiresIn = Date.parse(String(pending.json.pendingEmailExpiresAt)) - Date.now();
  assert.ok(expiresIn > 23 * HOUR && expiresIn <= 24 * HOUR, "a change link works for 24 hours");
  assert.equal(pending.json.email, me.email, "the current email stays until the new one is confirmed");

  // Runners and admins have settings too, but can't delete their account here.
  const runner = await userWithPassword("RUNNER");
  const runnerView = await call(runner, app.account.GET);
  assert.equal(runnerView.status, 200);
  assert.deepEqual([runnerView.json.role, runnerView.json.canDelete], ["RUNNER", false]);

  mail.setTestEmailMode("not-configured");
  try {
    assert.equal((await call(student, app.account.GET)).json.emailConfigured, false);
    const refused = await changeEmail(student, freshEmail("offline"));
    assert.equal(refused.status, 503);
    assert.equal(refused.json.code, "EMAIL_NOT_CONFIGURED");
  } finally {
    mail.setTestEmailMode("memory");
  }
});

test("profile: names are checked like sign-up, stored tidied, and audited without the names", { skip }, async () => {
  const { db } = app;
  const student = await userWithPassword();
  const save = (body: unknown) => call(student, app.profile.PATCH, { method: "PATCH", body });

  const bad = await save({ firstName: "   ", lastName: "Ok4for" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "INVALID_NAME");
  assert.equal(bad.json.error, "Enter your first name.");
  const fields = bad.json.fields as Record<string, string>;
  assert.equal(fields.firstName, "Enter your first name.");
  assert.match(fields.lastName, /only letters, spaces, apostrophes, hyphens and dots in your last name/);
  assert.equal((await save({ firstName: "Ada", lastName: "x".repeat(61) })).status, 400);
  assert.equal((await save(["Ada", "Okafor"])).json.code, "INVALID_REQUEST");

  const saved = await save({ firstName: "  Ada  ", lastName: "Okafor-Bello   O’Neil" });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json, { firstName: "Ada", lastName: "Okafor-Bello O’Neil" });
  const stored = await account(student.userId);
  assert.deepEqual([stored.firstName, stored.lastName], ["Ada", "Okafor-Bello O’Neil"]);

  const audits = await db.auditLog.findMany({ where: { actorId: student.userId, action: "ACCOUNT_PROFILE_UPDATED" } });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].resourceId, student.userId);
  assert.doesNotMatch(JSON.stringify(audits), /Ada|Okafor/, "no names in the audit trail");

  const unchanged = await save({ firstName: "Ada", lastName: "Okafor-Bello O’Neil" });
  assert.equal(unchanged.status, 200);
  assert.equal(await db.auditLog.count({ where: { actorId: student.userId, action: "ACCOUNT_PROFILE_UPDATED" } }), 1, "saving the same names writes nothing");
});

test("email change: refused for a wrong password, a taken, same or invalid address; then a link to the new address and a notice to the old", { skip }, async () => {
  const { db } = app;
  const student = await userWithPassword();
  const other = await createTestUser("STUDENT");
  const me = await account(student.userId);
  const otherEmail = (await account(other.userId)).email;
  const newEmail = freshEmail("changed");

  const wrong = await changeEmail(student, newEmail, "Wrong-pass-1");
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.code, "WRONG_PASSWORD");
  assert.equal((await changeEmail(student, newEmail, ` ${PASSWORD}`)).json.code, "WRONG_PASSWORD", "the current password is used exactly as typed");
  const taken = await changeEmail(student, ` ${otherEmail.toUpperCase()} `);
  assert.equal(taken.status, 409);
  assert.equal(taken.json.code, "EMAIL_TAKEN");
  const same = await changeEmail(student, me.email.toUpperCase());
  assert.equal(same.status, 400);
  assert.equal(same.json.code, "SAME_EMAIL");
  assert.equal(mailTo(newEmail).length + mailTo(me.email).length + mailTo(otherEmail).length, 0, "nothing is sent for a refused request");
  assert.equal(await db.accountToken.count({ where: { userId: student.userId } }), 0);

  // A fresh account for the rest, so the hourly limit at the end is counted from zero.
  const asker = await userWithPassword();
  const askerEmail = (await account(asker.userId)).email;
  const invalid = await changeEmail(asker, "not-an-email");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.code, "INVALID_EMAIL");
  const asked = await changeEmail(asker, newEmail);
  assert.equal(asked.status, 200, JSON.stringify(asked.json));
  assert.equal(asked.json.pendingEmail, newEmail);
  assert.equal(asked.json.status, "sent");

  const [confirmation] = mailTo(newEmail);
  assert.equal(mailTo(newEmail).length, 1);
  assert.equal(confirmation.purpose, "email-change");
  assert.ok(confirmation.text.includes(newEmail), "the new address sees itself in full");
  assert.match(confirmation.text, /http:\/\/packam\.test\/api\/account\/email\/confirm\?token=[A-Za-z0-9_-]{43}/);
  const notices = mailTo(askerEmail);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].purpose, "email-change-requested");
  assert.ok(notices[0].text.includes(maskEmail(newEmail)), "the old address sees the new one masked");
  assert.ok(!notices[0].text.includes(newEmail) && !/token=/.test(notices[0].text), "never the full new address or the link");

  const unchanged = await account(asker.userId);
  assert.deepEqual([unchanged.email, unchanged.emailVerifiedAt], [askerEmail, null], "the old email keeps working until confirmed");
  assert.equal(await db.auditLog.count({ where: { actorId: asker.userId, action: "ACCOUNT_EMAIL_CHANGE_REQUESTED" } }), 1);
  assert.doesNotMatch(JSON.stringify(await db.auditLog.findMany({ where: { actorId: asker.userId } })), /@/, "no addresses in the audit trail");

  // Five requests an hour, refused ones included.
  for (let i = 0; i < 3; i += 1) assert.equal((await changeEmail(asker, freshEmail("again"))).status, 200);
  const limited = await changeEmail(asker, freshEmail("limited"));
  assert.equal(limited.status, 429);
  assert.equal(limited.json.code, "RATE_LIMITED");
});

test("confirming switches the email, marks it confirmed, retires old links and tells the old address; replaced or junk links do nothing", { skip }, async () => {
  const { db, tokens } = app;
  const student = await userWithPassword();
  const oldEmail = (await account(student.userId)).email;
  const firstChoice = freshEmail("first");
  const finalChoice = freshEmail("final");

  const replaced = await requestChange(student, firstChoice);
  const link = await requestChange(student, finalChoice);
  // A reset link sent to the old address earlier must stop working with the change.
  const resetToken = await db.$transaction((tx) => tokens.issueAccountToken(tx, { userId: student.userId, purpose: "PASSWORD_RESET", email: oldEmail }));

  assert.deepEqual(await openLink(student, replaced), { status: 303, location: "/settings?email=used" }, "asking again replaced the first link");
  assert.equal((await account(student.userId)).email, oldEmail);
  assert.equal(app.confirm.HEAD().status, 200, "a link checker's HEAD request doesn't use the link up");

  assert.deepEqual(await openLink(student, link), { status: 303, location: "/settings?email=changed" });
  const changed = await account(student.userId);
  assert.equal(changed.email, finalChoice);
  assert.ok(changed.emailVerifiedAt, "the new address is confirmed by the link");
  assert.equal(changed.sessionVersion, 0, "this browser stays signed in");
  const notices = mailTo(oldEmail).filter((message) => message.purpose === "email-changed");
  assert.equal(notices.length, 1, "the old address is told");
  assert.deepEqual(await tokens.peekAccountToken(db, { token: resetToken, purpose: "PASSWORD_RESET" }), { ok: false, reason: "used" });
  assert.equal(await db.accountToken.count({ where: { userId: student.userId, usedAt: null } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: student.userId, action: "ACCOUNT_EMAIL_CHANGED" } }), 1);

  // Opened again (or after a mail scanner opened it first): it reads as done, and nothing happens twice.
  assert.deepEqual(await openLink(student, link), { status: 303, location: "/settings?email=changed" });
  assert.equal(mailTo(oldEmail).filter((message) => message.purpose === "email-changed").length, 1);
  assert.equal(await db.auditLog.count({ where: { actorId: student.userId, action: "ACCOUNT_EMAIL_CHANGED" } }), 1);

  for (const junk of ["http://packam.test/api/account/email/confirm", confirmLink("nope"), confirmLink("A".repeat(43)), confirmLink(resetToken)]) {
    assert.deepEqual(await openLink(student, junk), { status: 303, location: "/settings?email=invalid" }, junk);
  }
  const stale = await db.$transaction((tx) => tokens.issueAccountToken(tx, { userId: student.userId, purpose: "EMAIL_CHANGE", email: freshEmail("stale"), now: new Date(Date.now() - 25 * HOUR) }));
  assert.deepEqual(await openLink(student, confirmLink(stale)), { status: 303, location: "/settings?email=expired" });
  assert.equal((await account(student.userId)).email, finalChoice);
});

test("a link opened while signed out goes to login; an address taken meanwhile is refused and changes nothing", { skip }, async () => {
  const { db } = app;
  const student = await userWithPassword();
  const newEmail = freshEmail("signed-out");
  const link = await requestChange(student, newEmail);
  assert.deepEqual(await openLink(null, link), { status: 303, location: "/login?emailChanged=1" });
  assert.equal((await account(student.userId)).email, newEmail);

  const someoneElse = await userWithPassword();
  const anotherLink = await requestChange(student, freshEmail("other-browser"));
  assert.deepEqual(await openLink(someoneElse, anotherLink), { status: 303, location: "/login?emailChanged=1" }, "another account's browser isn't sent to its own settings");

  const contested = freshEmail("contested");
  const rival = await userWithPassword();
  const rivalEmail = (await account(rival.userId)).email;
  const rivalLink = await requestChange(rival, contested);
  const squatter = await createTestUser("STUDENT");
  await db.user.update({ where: { id: squatter.userId }, data: { email: contested } });
  assert.deepEqual(await openLink(rival, rivalLink), { status: 303, location: "/settings?email=taken" });
  const kept = await account(rival.userId);
  assert.deepEqual([kept.email, kept.emailVerifiedAt], [rivalEmail, null]);
  assert.equal(mailTo(rivalEmail).filter((message) => message.purpose === "email-changed").length, 0);
});

test("cancelling a pending email change retires its link", { skip }, async () => {
  const { db } = app;
  const student = await userWithPassword();
  const oldEmail = (await account(student.userId)).email;
  const link = await requestChange(student, freshEmail("cancelled"));

  const cancelled = await call(student, app.email.DELETE, { method: "DELETE" });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.deepEqual(cancelled.json, { ok: true, cancelled: true });
  assert.equal((await call(student, app.account.GET)).json.pendingEmail, null);
  assert.deepEqual(await openLink(student, link), { status: 303, location: "/settings?email=used" });
  assert.equal((await account(student.userId)).email, oldEmail);
  assert.deepEqual((await call(student, app.email.DELETE, { method: "DELETE" })).json, { ok: true, cancelled: false });
  assert.equal(await db.auditLog.count({ where: { actorId: student.userId, action: "ACCOUNT_EMAIL_CHANGE_CANCELLED" } }), 1);
});

test("password change: a wrong current or weak new password changes nothing; success re-hashes, signs out every device and sends a notice", { skip }, async () => {
  const { db, tokens } = app;
  const student = await userWithPassword();
  const before = await account(student.userId);
  const change = (body: unknown) => call(student, app.password.POST, { method: "POST", body });

  // Ten attempts an hour: the eight below stay under it.
  for (const currentPassword of ["Wrong-pass-1", ` ${PASSWORD}`, undefined]) {
    const wrong = await change({ currentPassword, newPassword: NEW_PASSWORD });
    assert.equal(wrong.status, 400, String(currentPassword));
    assert.equal(wrong.json.code, "WRONG_PASSWORD", "the current password is used exactly as typed");
  }
  for (const [newPassword, problem] of [["short1", /at least 8/], ["password123", /too common/], [" Padded-pass-1", /spaces/]] as const) {
    const weak = await change({ currentPassword: PASSWORD, newPassword });
    assert.equal(weak.status, 400, newPassword);
    assert.equal(weak.json.code, "WEAK_PASSWORD");
    assert.match(String(weak.json.error), problem);
  }
  const untouched = await account(student.userId);
  assert.deepEqual([untouched.passwordHash, untouched.sessionVersion, untouched.passwordChangedAt], [before.passwordHash, before.sessionVersion, null]);

  // Links made before the change: a reset link and an email change someone may have asked for.
  await db.$transaction((tx) => tokens.issueAccountToken(tx, { userId: student.userId, purpose: "PASSWORD_RESET", email: before.email }));
  await requestChange(student, freshEmail("pending-before-password"));

  const done = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.deepEqual(done.json, { ok: true, reauth: true });
  const after = await account(student.userId);
  assert.ok(after.passwordHash && (await bcrypt.compare(NEW_PASSWORD, after.passwordHash)), "the new password works");
  assert.equal(await bcrypt.compare(PASSWORD, after.passwordHash ?? ""), false, "the old one doesn't");
  assert.equal(after.sessionVersion, before.sessionVersion + 1, "every session cookie stops working");
  assert.ok(after.passwordChangedAt);
  assert.equal(await db.accountToken.count({ where: { userId: student.userId, usedAt: null } }), 0, "earlier reset and change links are retired");
  const notices = mailTo(before.email).filter((message) => message.purpose === "password-changed");
  assert.equal(notices.length, 1);
  assert.doesNotMatch(notices[0].text, new RegExp(NEW_PASSWORD), "the password is never emailed");
  assert.equal(await db.auditLog.count({ where: { actorId: student.userId, action: "ACCOUNT_PASSWORD_CHANGED" } }), 1);

  const old = await change({ currentPassword: PASSWORD, newPassword: "Another-campus-88" });
  assert.equal(old.json.code, "WRONG_PASSWORD", "the old password no longer counts as current");
});

test("signing out other devices or every device bumps the session version", { skip }, async () => {
  const { db } = app;
  const student = await userWithPassword();
  const signOut = (body: unknown) => call(student, app.sessions.POST, { method: "POST", body });
  const version = async () => (await account(student.userId)).sessionVersion;

  assert.equal((await signOut({ action: "others", currentPassword: "Wrong-pass-1" })).json.code, "WRONG_PASSWORD");
  for (const action of ["everyone", undefined, 1]) {
    const invalid = await signOut({ action, currentPassword: PASSWORD });
    assert.equal(invalid.status, 400, String(action));
    assert.equal(invalid.json.code, "INVALID_REQUEST");
  }
  assert.equal(await version(), 0);

  const others = await signOut({ action: "others", currentPassword: PASSWORD });
  assert.equal(others.status, 200, JSON.stringify(others.json));
  assert.deepEqual(others.json, { ok: true, reauth: true }, "this browser signs back in");
  assert.equal(await version(), 1);
  const everywhere = await signOut({ action: "all", currentPassword: PASSWORD });
  assert.deepEqual(everywhere.json, { ok: true, reauth: false }, "this browser signs out too");
  assert.equal(await version(), 2);
  const audits = await db.auditLog.findMany({ where: { actorId: student.userId, action: "ACCOUNT_SESSIONS_REVOKED" }, select: { newState: true } });
  assert.deepEqual(audits.map((row) => (row.newState as { scope?: string } | null)?.scope).sort(), ["all", "others"]);
});

test("only a student can delete their account, with their current password and the typed confirmation", { skip }, async () => {
  const runner = await userWithPassword("RUNNER");
  const admin = await userWithPassword("ADMIN");
  const body = { currentPassword: PASSWORD, confirm: "DELETE" };
  for (const staff of [runner, admin]) {
    const refused = await call(staff, app.remove.POST, { method: "POST", body });
    assert.equal(refused.status, 403, staff.role);
    assert.equal(refused.json.code, "STUDENTS_ONLY");
    assert.equal((await call(staff, app.remove.GET)).status, 403, staff.role);
    assert.equal((await account(staff.userId)).status, "ACTIVE");
  }

  const student = await userWithPassword();
  const remove = (input: unknown) => call(student, app.remove.POST, { method: "POST", body: input });
  assert.equal((await remove({ currentPassword: "Wrong-pass-1", confirm: "DELETE" })).json.code, "WRONG_PASSWORD");
  for (const confirm of [undefined, "", "DELET", "yes"]) assert.equal((await remove({ currentPassword: PASSWORD, confirm })).json.code, "CONFIRMATION_REQUIRED", String(confirm));
  const kept = await account(student.userId);
  assert.deepEqual([kept.status, kept.sessionVersion, kept.passwordHash !== null], ["ACTIVE", 0, true]);
});

test("anything unsettled blocks deletion with a message saying what to do, and nothing is changed", { skip }, async () => {
  const { db } = app;
  const order = (userId: string, status: OrderStatus) =>
    db.order.create({ data: { userId, status, subtotal: 1_000, deliveryFee: 200, total: 1_200, deliveryAddress: "Room 1, Test Hall, OOU" }, select: { id: true } });
  const payment = (userId: string, data: { status: PaymentStatus; orderId?: string; printJobId?: string }) =>
    db.payment.create({ data: { userId, provider: "OPAY", amount: 1_200, transactionReference: `acct-${randomUUID()}`, ...data }, select: { id: true } });

  const fixtures: Array<[DeletionBlockerKind, (userId: string) => Promise<unknown>]> = [
    ["ORDER_IN_PROGRESS", (userId) => order(userId, "FINDING_RUNNER")],
    ["ORDER_NOT_REFUNDED", async (userId) => payment(userId, { status: "SUCCESS", orderId: (await order(userId, "CANCELLED")).id })],
    ["PRINT_JOB_IN_PROGRESS", (userId) => db.printJob.create({ data: { userId, status: "PRINTING" } })],
    ["PRINT_JOB_NOT_REFUNDED", async (userId) => payment(userId, { status: "SUCCESS", printJobId: (await db.printJob.create({ data: { userId, status: "CANCELLED" } })).id })],
    ["PAYMENT_PENDING", (userId) => payment(userId, { status: "PENDING" })],
    ["PAYMENT_UNDER_REVIEW", async (userId) => db.paymentReviewCase.create({ data: { paymentId: (await payment(userId, { status: "FAILED" })).id } })],
    ["REFUND_UNSETTLED", async (userId) => db.refund.create({ data: { orderId: (await order(userId, "REFUNDED")).id, amount: 1_200, reason: "Test refund", status: "PENDING" } })],
    ["SUPPORT_CASE_OPEN", (userId) => db.supportCase.create({ data: { userId, subject: "My account: test", description: "A test support request that is still open." } })],
    ["INCIDENT_OPEN", async (userId) => db.incident.create({ data: { orderId: (await order(userId, "DELIVERED")).id, reportedById: userId, type: "DELIVERY_ISSUE" } })],
  ];
  for (const [kind, setUp] of fixtures) {
    const student = await userWithPassword();
    const before = await account(student.userId);
    await setUp(student.userId);

    const preview = await call(student, app.remove.GET);
    assert.equal(preview.status, 200, kind);
    assert.deepEqual((preview.json.blockers as Blocker[]).map((blocker) => blocker.kind), [kind], `${kind}: shown before asking`);
    const refused = await call(student, app.remove.POST, { method: "POST", body: { currentPassword: PASSWORD, confirm: "DELETE" } });
    assert.equal(refused.status, 409, kind);
    assert.equal(refused.json.code, "DELETION_BLOCKED");
    assert.deepEqual(refused.json.blockers, [{ kind, message: deletionBlockerMessage(kind, 1), count: 1 }], kind);
    const after = await account(student.userId);
    assert.deepEqual([after.status, after.email, after.firstName, after.sessionVersion], ["ACTIVE", before.email, before.firstName, 0], `${kind}: nothing changed`);
    assert.equal(mailTo(before.email).length, 0, kind);
  }

  // PAYMENT_UNMATCHED (a successful payment with nothing it paid for) can only come from legacy rows: the database
  // now refuses to store one (Payment_success_requires_fulfilment_root_check), so there is no fixture for it.
  const legacy = await createTestUser("STUDENT");
  await assert.rejects(payment(legacy.userId, { status: "SUCCESS" }));
});

test("deleting a student account anonymises it in place: personal details go, money and history stay", { skip }, async () => {
  const { db, tokens } = app;
  const student = await userWithPassword();
  const userId = student.userId;
  const phone = freshPhone();
  await db.user.update({ where: { id: userId }, data: { phone, lastName: "Okafor", emailVerifiedAt: new Date() } });
  await db.studentProfile.update({ where: { userId }, data: { matricNumber: "TEST/2026/0001", department: "Testing", faculty: "Science", level: "200" } });
  const before = await account(userId);

  const location = await createTestLocation(userId);
  const { products } = await createTestCatalogue([{ name: "Deletion pen", price: 300 }]);
  const cart = await db.cart.create({ data: { userId, items: { create: { productId: products[0].id, quantity: 2 } } } });
  const delivered = await db.order.create({ data: { userId, status: "DELIVERED", subtotal: 1_000, deliveryFee: 200, total: 1_200, deliveryAddress: "Room 1, Test Hall, OOU", deliveryLocationId: location.id } });
  await db.payment.create({ data: { userId, orderId: delivered.id, provider: "OPAY", status: "SUCCESS", amount: 1_200, transactionReference: `acct-${randomUUID()}`, paidAt: new Date() } });
  const failedCheckout = await db.payment.create({ data: { userId, provider: "OPAY", status: "FAILED", amount: 500, transactionReference: `acct-${randomUUID()}` } });
  const printed = await db.printJob.create({ data: { userId, status: "DELIVERED", total: 300 } });
  await db.payment.create({ data: { userId, printJobId: printed.id, provider: "OPAY", status: "SUCCESS", amount: 300, transactionReference: `acct-${randomUUID()}`, paidAt: new Date() } });
  const draft = await db.printJob.create({ data: { userId, status: "DRAFT" } });
  const unpaid = await db.printJob.create({ data: { userId, status: "READY_FOR_PAYMENT", total: 400 } });
  await db.payment.create({ data: { userId, printJobId: unpaid.id, provider: "OPAY", status: "FAILED", amount: 400, transactionReference: `acct-${randomUUID()}` } });
  const waiting = await db.productRequest.create({ data: { userId, requestedName: "Test calculator" } });
  const answered = await db.productRequest.create({ data: { userId, requestedName: "Test ruler", status: "AVAILABLE" } });
  const support = await db.supportCase.create({ data: { userId, subject: "My account: old question", description: "An old request that was answered.", status: "RESOLVED" } });
  await db.notification.create({ data: { userId, type: "ORDER", title: "Test", message: "A test notification.", idempotencyKey: `acct-${randomUUID()}` } });
  const earlierAudit = await db.auditLog.create({ data: { actorId: userId, action: "checkout.cancelled_by_student", resource: "Payment", resourceId: failedCheckout.id } });
  await db.$transaction((tx) => tokens.issueAccountToken(tx, { userId, purpose: "EMAIL_VERIFICATION", email: before.email }));

  assert.deepEqual((await call(student, app.remove.GET)).json, { blockers: [] });
  const deleted = await call(student, app.remove.POST, { method: "POST", body: { currentPassword: PASSWORD, confirm: " delete " } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(deleted.json, { ok: true });

  const gone = await account(userId);
  assert.deepEqual(
    { status: gone.status, role: gone.role, email: gone.email, firstName: gone.firstName, lastName: gone.lastName, phone: gone.phone, passwordHash: gone.passwordHash, emailVerifiedAt: gone.emailVerifiedAt, sessionVersion: gone.sessionVersion },
    { status: "DEACTIVATED", role: "STUDENT", email: deletedAccountEmail(userId), firstName: null, lastName: null, phone: null, passwordHash: null, emailVerifiedAt: null, sessionVersion: before.sessionVersion + 1 },
  );
  const profile = await db.studentProfile.findUniqueOrThrow({ where: { userId } });
  assert.deepEqual([profile.matricNumber, profile.department, profile.faculty, profile.level], [null, null, null, null]);
  assert.equal(await db.savedLocation.count({ where: { userId } }), 0);
  assert.equal(await db.cart.count({ where: { userId } }), 0);
  assert.equal(await db.cartItem.count({ where: { cartId: cart.id } }), 0);
  assert.equal(await db.notification.count({ where: { userId } }), 0);
  assert.equal(await db.accountToken.count({ where: { userId } }), 0);

  // Kept: orders (with their own address copy), payments, print jobs, support history and the audit trail.
  const keptOrder = await db.order.findUniqueOrThrow({ where: { id: delivered.id } });
  assert.deepEqual([keptOrder.status, keptOrder.deliveryAddress, keptOrder.deliveryLocationId], ["DELIVERED", "Room 1, Test Hall, OOU", null]);
  assert.equal(await db.payment.count({ where: { userId } }), 4);
  assert.equal((await db.printJob.findUniqueOrThrow({ where: { id: printed.id } })).status, "DELIVERED");
  for (const job of [draft, unpaid]) {
    assert.equal((await db.printJob.findUniqueOrThrow({ where: { id: job.id } })).status, "CANCELLED", "a never-paid print job is cancelled");
    assert.equal(await db.printJobStatusHistory.count({ where: { printJobId: job.id, status: "CANCELLED", actorId: userId } }), 1);
  }
  assert.equal((await db.productRequest.findUniqueOrThrow({ where: { id: waiting.id } })).status, "CANCELLED");
  assert.equal((await db.productRequest.findUniqueOrThrow({ where: { id: answered.id } })).status, "AVAILABLE");
  assert.equal((await db.supportCase.findUniqueOrThrow({ where: { id: support.id } })).status, "RESOLVED");
  assert.ok(await db.auditLog.findUnique({ where: { id: earlierAudit.id } }), "earlier audit rows stay");
  const deletionAudit = await db.auditLog.findMany({ where: { actorId: userId, action: "ACCOUNT_DELETED", resource: "User", resourceId: userId } });
  assert.equal(deletionAudit.length, 1);
  const personal = [before.email, phone, before.firstName, "Okafor", "TEST/2026", "Room 1"].filter((value): value is string => Boolean(value));
  const auditText = JSON.stringify(deletionAudit);
  for (const value of personal) assert.ok(!auditText.includes(value), `nothing personal in the audit row (${value.length} characters)`);

  const goodbye = mailTo(before.email).filter((message) => message.purpose === "account-deleted");
  assert.equal(goodbye.length, 1, "the old address gets one goodbye email");

  // The account is closed everywhere, and its old email and phone are free for a new account.
  assert.equal((await call(student, app.account.GET)).status, 401);
  assert.equal((await call(student, app.remove.POST, { method: "POST", body: { currentPassword: PASSWORD, confirm: "DELETE" } })).status, 401);
  assert.equal(await db.user.count({ where: { OR: [{ email: before.email }, { phone }] } }), 0);
});

test("after a deletion, finished print documents leave storage; files of active accounts or unfinished jobs stay", { skip }, async () => {
  const { db, deletion } = app;
  const student = await createTestUser("STUDENT");
  const userId = student.userId;
  const document = async (status: "DELIVERED" | "CANCELLED" | "PRINTING") => {
    const job = await db.printJob.create({ data: { userId, status } });
    return db.printDocument.create({
      data: { printJobId: job.id, uploadedById: userId, publicId: `packam/print-jobs/test-${randomUUID()}.pdf`, originalFileName: "synthetic-delete-test.pdf", mimeType: "application/pdf", fileSize: 48_000, pageCount: 2 },
      select: { id: true, publicId: true },
    });
  };
  const delivered = await document("DELIVERED");
  const failing = await document("CANCELLED");
  const inProgress = await document("PRINTING");
  const removedFiles: string[] = [];
  const fakeStorage = async (publicId: string) => {
    if (publicId === failing.publicId) throw new Error("Storage is unavailable.");
    removedFiles.push(publicId);
  };

  assert.deepEqual(await deletion.removeDeletedAccountDocuments(userId, fakeStorage), { removed: 0, failed: 0 }, "an active account's files are never touched");
  assert.deepEqual(removedFiles, []);

  await db.user.update({ where: { id: userId }, data: { status: "DEACTIVATED" } });
  assert.deepEqual(await deletion.removeDeletedAccountDocuments(userId, fakeStorage), { removed: 1, failed: 1 }, "one failure doesn't stop the others");
  assert.deepEqual(removedFiles, [delivered.publicId]);
  const deletedAt = async (id: string) => (await db.printDocument.findUniqueOrThrow({ where: { id } })).deletedAt;
  assert.ok(await deletedAt(delivered.id), "the record stays, marked deleted");
  assert.equal(await deletedAt(failing.id), null, "a failed removal is left to try again");
  assert.equal(await deletedAt(inProgress.id), null, "an unfinished job keeps its file");
});
