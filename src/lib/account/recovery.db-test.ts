/**
 * Password recovery and email confirmation against a disposable database, through the real routes:
 * forgot-password answers the same for every address, a reset link works once for 30 minutes and signs every
 * device out, and a confirmation link only confirms the address it was sent to. Emails land in the in-memory test
 * outbox (src/lib/email) and tokens are read from the links in them, as a person would follow them.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 *
 * Passwords and addresses below are test fixtures only.
 */
import {
  callRoute,
  cleanupTestData,
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
import { hashToken, newToken } from "./tokens";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  email: typeof import("../email");
  tokens: typeof import("./account-tokens");
  request: typeof import("../../app/api/account/password-reset/request/route");
  confirm: typeof import("../../app/api/account/password-reset/confirm/route");
  verify: typeof import("../../app/api/account/verify-email/route");
  resend: typeof import("../../app/api/account/verify-email/resend/route");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [email, tokens, request, confirm, verify, resend] = await Promise.all([
    import("../email"),
    import("./account-tokens"),
    import("../../app/api/account/password-reset/request/route"),
    import("../../app/api/account/password-reset/confirm/route"),
    import("../../app/api/account/verify-email/route"),
    import("../../app/api/account/verify-email/resend/route"),
  ]);
  app = { db, email, tokens, request, confirm, verify, resend };
});
after(async () => {
  if (!skip) app.email.setTestEmailMode("memory");
  await cleanupTestData();
});

const OLD_PASSWORD = "Old-pass-2024";
const NEW_PASSWORD = "Fresh-mango-58";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

type User = Awaited<ReturnType<typeof createTestUser>> & { email: string };

/** A student with their own address and, unless `password` is false, the password OLD_PASSWORD. */
async function student(options: { password?: boolean } = {}): Promise<User> {
  const user = await createTestUser("STUDENT");
  if (options.password !== false) await setTestPassword(user.userId, OLD_PASSWORD);
  const { email } = await app.db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { email: true } });
  return { ...user, email };
}

/** Each call comes from its own network unless headers say otherwise, so the per-network limit never interferes. */
function requestReset(email: string, headers: Record<string, string> = {}) {
  return callRoute(app.request.POST, { method: "POST", path: "/api/account/password-reset/request", body: { email }, headers: { "x-real-ip": testClientIp(), ...headers } });
}

function confirmReset(token: unknown, password: string, headers: Record<string, string> = {}) {
  return callRoute(app.confirm.POST, { method: "POST", path: "/api/account/password-reset/confirm", body: { token, password }, headers: { "x-real-ip": testClientIp(), ...headers } });
}

function resendLink(user: User | null, headers: Record<string, string> = {}) {
  signInAs(user);
  return callRoute(app.resend.POST, { method: "POST", path: "/api/account/verify-email/resend", headers });
}

/** Calls a POST handler directly, keeping the response headers callRoute drops (Retry-After). */
async function postKeepingHeaders(handler: (request: Request) => Promise<Response>, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await handler(new Request(`http://packam.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: response.status, json: (await response.json()) as Record<string, unknown>, retryAfter: response.headers.get("retry-after") };
}

/** Opens a confirmation link as a browser would. The answer is a 303 to the result page. */
async function openConfirmationLink(token: string | null) {
  const query = token === null ? "" : `?token=${encodeURIComponent(token)}`;
  const response = await app.verify.GET(new Request(`http://packam.test/api/account/verify-email${query}`));
  return { status: response.status, location: response.headers.get("location") };
}

const landedOn = (status: string) => ({ status: 303, location: `/verify-email?status=${status}` });

/** Captured emails to `address` for `purpose`, oldest first. Every test user has an address of its own. */
function mailTo(address: string, purpose: string) {
  return app.email.testOutbox().filter((message) => message.to === address && message.purpose === purpose);
}

/** The raw token from an email's link, checking the link goes where it should with the token in the query string. */
function tokenFrom(message: { text: string; html: string } | undefined, path: string) {
  assert.ok(message, "an email was sent");
  const link = message.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(link, "the email carries a link");
  const url = new URL(link);
  assert.equal(`${url.origin}${url.pathname}`, `http://packam.test${path}`);
  const token = url.searchParams.get("token");
  assert.ok(token && /^[A-Za-z0-9_-]{43}$/.test(token), "a 43-character token in the query string");
  assert.ok(message.html.includes(token), "the HTML part has the same link");
  return token;
}

const tokenRow = (token: string) => app.db.accountToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });

const passwordHashOf = async (userId: string) =>
  (await app.db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } })).passwordHash ?? "";

/** Moves a link's whole life into the past (createdAt too: the table requires expiresAt after createdAt). */
async function expire(token: string) {
  const now = Date.now();
  await app.db.accountToken.update({ where: { tokenHash: hashToken(token) }, data: { createdAt: new Date(now - 2 * 24 * HOUR), expiresAt: new Date(now - MINUTE) } });
}

test("forgot password answers the same for every address; only an active account with a password gets a 30-minute link", { skip }, async () => {
  const { db } = app;
  const known = await student();
  const passwordless = await student({ password: false });
  const suspended = await student();
  const closed = await student();
  await db.user.update({ where: { id: suspended.userId }, data: { status: "SUSPENDED" } });
  await db.user.update({ where: { id: closed.userId }, data: { status: "DEACTIVATED" } });
  const nobody = `nobody-${randomUUID()}@packam.test`;

  for (const email of [nobody, passwordless.email, suspended.email, closed.email, known.email]) {
    const answer = await requestReset(email);
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    assert.deepEqual(answer.json, { ok: true }, "one answer for every address");
  }
  for (const user of [passwordless, suspended, closed]) {
    assert.equal(mailTo(user.email, "password-reset").length, 0, "no first password for a passwordless account, nothing for a suspended or closed one");
    assert.equal(await db.accountToken.count({ where: { userId: user.userId } }), 0);
  }

  const sent = mailTo(known.email, "password-reset");
  assert.equal(sent.length, 1, "the active account with a password gets one email");
  assert.equal(sent[0].subject, "Reset your PackAM password");
  const token = tokenFrom(sent[0], "/reset-password");
  const row = await tokenRow(token);
  assert.deepEqual([row.userId, row.purpose, row.email, row.usedAt], [known.userId, "PASSWORD_RESET", known.email, null]);
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 30 * MINUTE, "a reset link lasts 30 minutes");
  assert.notEqual(row.tokenHash, token, "only the token's hash is stored");
});

test("forgot password matches the address however it's typed, and sends at most 3 emails an hour to it, silently", { skip }, async () => {
  const user = await student();
  for (const typed of [`  ${user.email.toUpperCase()}  `, user.email, user.email, user.email]) {
    const answer = await requestReset(typed);
    assert.deepEqual([answer.status, answer.json], [200, { ok: true }], "the 4th answer is the same");
  }
  const tokens = mailTo(user.email, "password-reset").map((message) => tokenFrom(message, "/reset-password"));
  assert.equal(tokens.length, 3, "the 4th request in the hour sends nothing");
  assert.notEqual((await tokenRow(tokens[0])).usedAt, null, "sending a new link stops the older ones working");
  assert.equal((await tokenRow(tokens[2])).usedAt, null);
});

test("forgot password: 429 only for too many requests from one network; 400 for anything that isn't an email", { skip }, async () => {
  const network = testClientIp();
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await requestReset(`nobody-${randomUUID()}@packam.test`, { "x-real-ip": network })).status, 200);
  }
  const limited = await postKeepingHeaders(app.request.POST, "/api/account/password-reset/request", { email: `nobody-${randomUUID()}@packam.test` }, { "x-real-ip": network });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.code, "RATE_LIMITED");
  assert.ok(Number(limited.retryAfter) >= 1, "Retry-After says when to try again");

  for (const email of ["", "not-an-email", "08012345678", 42, null]) {
    const answer = await callRoute(app.request.POST, { method: "POST", path: "/api/account/password-reset/request", body: { email }, headers: { "x-real-ip": testClientIp() } });
    assert.equal(answer.status, 400, String(email));
    assert.equal(answer.json.code, "INVALID_EMAIL");
  }
});

test("a reset sets the new password, signs every device out, kills the other links and sends a notice", { skip }, async () => {
  const { db } = app;
  const user = await student();
  const before = await db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { sessionVersion: true, emailVerifiedAt: true } });
  assert.equal(before.emailVerifiedAt, null);
  await requestReset(user.email);
  const token = tokenFrom(mailTo(user.email, "password-reset")[0], "/reset-password");
  // Two more open links: a stray reset link (written directly, since sending a new one would revoke the first)
  // and a pending email change, which a reset should cancel.
  const strayReset = newToken();
  const pendingChange = newToken();
  const soon = new Date(Date.now() + 30 * MINUTE);
  await db.accountToken.createMany({
    data: [
      { userId: user.userId, purpose: "PASSWORD_RESET", email: user.email, tokenHash: hashToken(strayReset), expiresAt: soon },
      { userId: user.userId, purpose: "EMAIL_CHANGE", email: `new-${randomUUID()}@packam.test`, tokenHash: hashToken(pendingChange), expiresAt: soon },
    ],
  });

  const common = await confirmReset(token, "password123");
  assert.equal(common.status, 400);
  assert.equal(common.json.code, "WEAK_PASSWORD");
  const personal = await confirmReset(token, `${user.email.split("@")[0]}-9!`);
  assert.equal(personal.json.code, "WEAK_PASSWORD", "the person's email can't be in it");
  assert.equal((await tokenRow(token)).usedAt, null, "a password that isn't allowed doesn't use the link up");
  assert.ok(await bcrypt.compare(OLD_PASSWORD, await passwordHashOf(user.userId)), "and changes nothing");

  const reset = await confirmReset(token, NEW_PASSWORD);
  assert.equal(reset.status, 200, JSON.stringify(reset.json));
  assert.deepEqual(reset.json, { ok: true });

  const now = await db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { passwordHash: true, sessionVersion: true, passwordChangedAt: true, emailVerifiedAt: true, status: true } });
  assert.match(now.passwordHash ?? "", /^\$2[aby]\$12\$/, "bcrypt at cost 12");
  assert.ok(await bcrypt.compare(NEW_PASSWORD, now.passwordHash ?? ""), "the new password works");
  assert.equal(await bcrypt.compare(OLD_PASSWORD, now.passwordHash ?? ""), false, "the old one doesn't");
  assert.equal(now.sessionVersion, before.sessionVersion + 1, "every device is signed out");
  assert.ok(now.passwordChangedAt);
  assert.ok(now.emailVerifiedAt, "opening the link proved the inbox, so the email is confirmed");
  assert.equal(now.status, "ACTIVE");

  const again = await confirmReset(token, "Another-pass-77");
  assert.deepEqual([again.status, again.json.code], [400, "USED_TOKEN"], "a link works once");
  const stray = await confirmReset(strayReset, "Another-pass-77");
  assert.deepEqual([stray.status, stray.json.code], [400, "USED_TOKEN"], "every other reset link stopped working");
  assert.notEqual((await tokenRow(pendingChange)).usedAt, null, "a pending email change is cancelled");
  assert.ok(await bcrypt.compare(NEW_PASSWORD, await passwordHashOf(user.userId)), "neither changed the password");

  const notices = mailTo(user.email, "password-changed");
  assert.equal(notices.length, 1, "a notice goes to the account's email");
  assert.equal(notices[0].subject, "Your PackAM password was changed");
  assert.equal(await db.auditLog.count({ where: { actorId: user.userId, action: "PASSWORD_RESET", resource: "User", resourceId: user.userId } }), 1);
});

test("a reset link works for 30 minutes, for resets only, and only while the account is active at the same address", { skip }, async () => {
  const { db } = app;
  const late = await student();
  await requestReset(late.email);
  const lateToken = tokenFrom(mailTo(late.email, "password-reset")[0], "/reset-password");
  await expire(lateToken);
  const expired = await confirmReset(lateToken, NEW_PASSWORD);
  assert.deepEqual([expired.status, expired.json.code], [400, "EXPIRED_TOKEN"]);
  assert.ok(await bcrypt.compare(OLD_PASSWORD, await passwordHashOf(late.userId)), "an expired link changes nothing");

  const confirmation = await app.tokens.issueAccountToken(db, { userId: late.userId, purpose: "EMAIL_VERIFICATION", email: late.email });
  for (const token of [newToken(), confirmation, "not-a-token", "", null, 12345]) {
    const answer = await confirmReset(token, NEW_PASSWORD);
    assert.deepEqual([answer.status, answer.json.code], [400, "INVALID_TOKEN"], String(token));
  }
  assert.ok(await bcrypt.compare(OLD_PASSWORD, await passwordHashOf(late.userId)));

  // Suspended after the link was sent: refused, never reactivated, and the link isn't spent.
  const paused = await student();
  await requestReset(paused.email);
  const pausedToken = tokenFrom(mailTo(paused.email, "password-reset")[0], "/reset-password");
  await db.user.update({ where: { id: paused.userId }, data: { status: "SUSPENDED" } });
  const refused = await confirmReset(pausedToken, NEW_PASSWORD);
  assert.deepEqual([refused.status, refused.json.code], [400, "INVALID_TOKEN"]);
  const pausedNow = await db.user.findUniqueOrThrow({ where: { id: paused.userId }, select: { status: true, passwordHash: true, sessionVersion: true } });
  assert.equal(pausedNow.status, "SUSPENDED", "a reset never reactivates an account");
  assert.ok(await bcrypt.compare(OLD_PASSWORD, pausedNow.passwordHash ?? ""));
  assert.equal(pausedNow.sessionVersion, 0);
  assert.equal((await tokenRow(pausedToken)).usedAt, null);

  // The account moved to another address after the link was sent: the link no longer fits it.
  const moved = await student();
  await requestReset(moved.email);
  const movedToken = tokenFrom(mailTo(moved.email, "password-reset")[0], "/reset-password");
  await db.user.update({ where: { id: moved.userId }, data: { email: `moved-${randomUUID()}@packam.test` } });
  const stale = await confirmReset(movedToken, NEW_PASSWORD);
  assert.deepEqual([stale.status, stale.json.code], [400, "INVALID_TOKEN"]);
  assert.ok(await bcrypt.compare(OLD_PASSWORD, await passwordHashOf(moved.userId)));
});

test("a confirmation link confirms only the address it was sent to: verified, already, used, expired, invalid", { skip }, async () => {
  const { db } = app;
  const issue = (user: User) => app.tokens.issueAccountToken(db, { userId: user.userId, purpose: "EMAIL_VERIFICATION", email: user.email });
  const confirmedAt = async (user: User) => (await db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { emailVerifiedAt: true } })).emailVerifiedAt;

  // Works signed out; a HEAD probe (link checkers) uses nothing up; a second open (or a mail scanner first) says "already".
  signInAs(null);
  const ada = await student({ password: false });
  const adaLink = await issue(ada);
  assert.equal(app.verify.HEAD().status, 204);
  assert.deepEqual(await openConfirmationLink(adaLink), landedOn("verified"));
  assert.ok(await confirmedAt(ada));
  assert.deepEqual(await openConfirmationLink(adaLink), landedOn("already"));

  // Only the newest link works; an expired one confirms nothing.
  const ben = await student({ password: false });
  const older = await issue(ben);
  const newer = await issue(ben);
  assert.deepEqual(await openConfirmationLink(older), landedOn("used"));
  await expire(newer);
  assert.deepEqual(await openConfirmationLink(newer), landedOn("expired"));
  assert.equal(await confirmedAt(ben), null);

  // Sent before the email changed: it proves nothing about the new address.
  const cara = await student({ password: false });
  const caraLink = await issue(cara);
  await db.user.update({ where: { id: cara.userId }, data: { email: `cara-${randomUUID()}@packam.test` } });
  assert.deepEqual(await openConfirmationLink(caraLink), landedOn("invalid"));
  assert.equal(await confirmedAt(cara), null);

  // Already confirmed (say, by a password reset): the first confirmation time is kept, even an expired link says so.
  const dan = await student({ password: false });
  const firstConfirmed = new Date("2026-01-02T03:04:05.000Z");
  await db.user.update({ where: { id: dan.userId }, data: { emailVerifiedAt: firstConfirmed } });
  assert.deepEqual(await openConfirmationLink(await issue(dan)), landedOn("already"));
  const danExpired = await issue(dan);
  await expire(danExpired);
  assert.deepEqual(await openConfirmationLink(danExpired), landedOn("already"));
  assert.equal((await confirmedAt(dan))?.toISOString(), firstConfirmed.toISOString());

  // Not a confirmation link at all.
  const resetLink = await app.tokens.issueAccountToken(db, { userId: dan.userId, purpose: "PASSWORD_RESET", email: dan.email });
  for (const token of [null, "", "nope", newToken(), resetLink]) {
    assert.deepEqual(await openConfirmationLink(token), landedOn("invalid"), String(token));
  }

  // The token stays out of caches and referrers.
  const response = await app.verify.GET(new Request("http://packam.test/api/account/verify-email?token=nope"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("resend: signed in only; a new 24-hour link, a 60-second cooldown and 3 an hour; nothing once confirmed", { skip }, async () => {
  const { db } = app;
  const user = await student({ password: false });
  assert.equal((await resendLink(null)).status, 401);

  const sent = await resendLink(user);
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.deepEqual(sent.json, { status: "sent" });
  const [first] = mailTo(user.email, "email-verification");
  assert.equal(first?.subject, "Confirm your email for PackAM");
  const row = await tokenRow(tokenFrom(first, "/api/account/verify-email"));
  assert.deepEqual([row.userId, row.purpose, row.email], [user.userId, "EMAIL_VERIFICATION", user.email]);
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 24 * HOUR, "a confirmation link lasts 24 hours");

  signInAs(user);
  const tooSoon = await postKeepingHeaders(app.resend.POST, "/api/account/verify-email/resend");
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.json.code, "RATE_LIMITED");
  const wait = Number(tooSoon.retryAfter);
  assert.ok(wait >= 1 && wait <= 60, `Retry-After is within the minute (${tooSoon.retryAfter})`);
  assert.equal(tooSoon.json.retryAfterSeconds, wait);
  assert.equal(mailTo(user.email, "email-verification").length, 1, "nothing sent during the cooldown");

  // Past the cooldown each time (the links moved a minute into the past): two more links, then the hourly limit.
  const statuses: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    await db.accountToken.updateMany({ where: { userId: user.userId, purpose: "EMAIL_VERIFICATION" }, data: { createdAt: new Date(Date.now() - 61 * 1000) } });
    statuses.push((await resendLink(user)).status);
  }
  assert.deepEqual(statuses, [200, 200, 429], "3 links an hour");
  const links = mailTo(user.email, "email-verification").map((message) => tokenFrom(message, "/api/account/verify-email"));
  assert.equal(links.length, 3);

  assert.deepEqual(await openConfirmationLink(links[2]), landedOn("verified"));
  assert.deepEqual(await openConfirmationLink(links[0]), landedOn("already"), "an older link, once the address is confirmed");
  const confirmed = await resendLink(user);
  assert.deepEqual([confirmed.status, confirmed.json], [200, { status: "already-verified" }]);
  assert.equal(mailTo(user.email, "email-verification").length, 3, "nothing sent once confirmed");
});

test("when email can't be sent: 503 and nothing stored; when a send fails: the same answer, logged without the address", { skip }, async (t) => {
  const { db } = app;
  const user = await student();
  try {
    app.email.setTestEmailMode("not-configured");
    const forgot = await requestReset(user.email);
    assert.deepEqual([forgot.status, forgot.json.code], [503, "EMAIL_NOT_CONFIGURED"]);
    const resend = await resendLink(user);
    assert.deepEqual([resend.status, resend.json.code], [503, "EMAIL_NOT_CONFIGURED"]);
    assert.equal(await db.accountToken.count({ where: { userId: user.userId } }), 0, "no link is made that can't be sent");

    const logged: string[] = [];
    const capture = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
    t.mock.method(console, "error", capture);
    t.mock.method(console, "warn", capture);
    app.email.setTestEmailMode("failing");
    const failing = await requestReset(user.email);
    assert.deepEqual([failing.status, failing.json], [200, { ok: true }], "a provider failure doesn't change the answer");
    assert.equal(mailTo(user.email, "password-reset").length, 0);
    assert.ok(logged.some((line) => line.includes("password-reset")), "the failure is logged by purpose");
    assert.ok(!logged.some((line) => line.includes(user.email) || line.includes("packam.test/")), "never with the address or the link");
  } finally {
    app.email.setTestEmailMode("memory");
  }
});

test("cross-site requests and non-JSON bodies are refused before anything happens", { skip }, async () => {
  const user = await student();
  const otherSites: Array<Record<string, string>> = [
    { "Sec-Fetch-Site": "cross-site" },
    { Origin: "https://evil.example" },
    { "Sec-Fetch-Site": "same-site", Origin: "https://shop.packam.test" },
  ];
  for (const headers of otherSites) {
    const refused = await requestReset(user.email, headers);
    assert.deepEqual([refused.status, refused.json.code], [403, "CROSS_SITE_REQUEST"], JSON.stringify(headers));
  }
  const textBody = await requestReset(user.email, { "Content-Type": "text/plain" });
  assert.deepEqual([textBody.status, textBody.json.code], [415, "JSON_REQUIRED"]);
  assert.equal(mailTo(user.email, "password-reset").length, 0, "nothing sent");

  const ownPage = await requestReset(user.email, { Origin: "http://packam.test", "Sec-Fetch-Site": "same-origin" });
  assert.equal(ownPage.status, 200, "PackAM's own pages pass");
  const token = tokenFrom(mailTo(user.email, "password-reset")[0], "/reset-password");

  assert.equal((await confirmReset(token, NEW_PASSWORD, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await confirmReset(token, NEW_PASSWORD, { "Content-Type": "application/x-www-form-urlencoded" })).status, 415);
  assert.equal((await tokenRow(token)).usedAt, null, "the link is untouched");
  assert.ok(await bcrypt.compare(OLD_PASSWORD, await passwordHashOf(user.userId)));

  const resend = await resendLink(user, { Origin: "https://evil.example" });
  assert.deepEqual([resend.status, resend.json.code], [403, "CROSS_SITE_REQUEST"]);
  assert.equal(mailTo(user.email, "email-verification").length, 0);
});
