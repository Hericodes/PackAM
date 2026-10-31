/**
 * Sign-up through the real route against a disposable database: the account it makes (an active student with a
 * profile and a cart, stored the way login looks it up), the confirmation email and the link in it, the checks it
 * shares with the form, emails and phone numbers already in use (also when two sign-ups race for one), the
 * cross-site guard and the per-network limit. Emails land in the in-memory test outbox; nothing is sent.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 *
 * Names, addresses, phone numbers and passwords below are test fixtures only.
 */
import {
  callRoute,
  cleanupTestData,
  dbTestSkip as skip,
  testClientIp,
  testDb,
  trackForCleanup,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";
import { hashToken } from "./tokens";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  email: typeof import("../email");
  register: typeof import("../../app/api/register/route");
  verify: typeof import("../../app/api/account/verify-email/route");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [email, register, verify] = await Promise.all([
    import("../email"),
    import("../../app/api/register/route"),
    import("../../app/api/account/verify-email/route"),
  ]);
  app = { db, email, register, verify };
});
after(async () => {
  if (!skip) app.email.setTestEmailMode("memory");
  await cleanupTestData();
});

const PASSWORD = "Fresh-mango-58";
const HOUR = 60 * 60 * 1000;
const EMAIL_TAKEN = { success: false, message: "An account with this email already exists.", code: "EMAIL_TAKEN" };
const PHONE_TAKEN = { success: false, message: "An account with this phone number already exists.", code: "PHONE_TAKEN" };

type Details = { firstName: string; lastName: string; email: string; phone: string; password: string };

const freshEmail = (label = "signup") => `${label}-${randomUUID()}@packam.test`;
const freshPhone = () => `080${String(parseInt(randomUUID().replace(/-/g, "").slice(0, 10), 16) % 100_000_000).padStart(8, "0")}`;
/** Sign-up details nobody has used yet. */
const details = (overrides: Partial<Details> = {}): Details => ({
  firstName: "Adaeze",
  lastName: "Okafor",
  email: freshEmail(),
  phone: freshPhone(),
  password: PASSWORD,
  ...overrides,
});

/** POST /api/register, from a network of its own unless headers say otherwise. */
async function signUp(body: unknown, headers: Record<string, string> = {}) {
  const response = await callRoute(app.register.POST, { method: "POST", path: "/api/register", body, headers: { "x-real-ip": testClientIp(), ...headers } });
  await trackAccountFor(body);
  return response;
}

/** The same request made directly, keeping the response headers callRoute drops (Retry-After). */
async function signUpKeepingHeaders(body: unknown, headers: Record<string, string>) {
  const response = await app.register.POST(new Request("http://packam.test/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
  await trackAccountFor(body);
  return { status: response.status, json: (await response.json()) as Record<string, unknown>, retryAfter: response.headers.get("retry-after") };
}

/** Accounts made through the API aren't fixtures, so each one is registered for cleanup by its address. */
async function trackAccountFor(body: unknown) {
  const email = body !== null && typeof body === "object" ? (body as { email?: unknown }).email : undefined;
  if (typeof email !== "string") return;
  const user = await app.db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  if (user) trackForCleanup({ users: [user.id] });
}

const accountsWith = (where: { email?: string; phone?: string }) => app.db.user.count({ where });
/** Captured emails to `address`, oldest first. Every test address is used once. */
const mailTo = (address: string) => app.email.testOutbox().filter((message) => message.to === address);

test("sign-up makes an active student with a profile and a cart, and emails a link that confirms the address", { skip }, async () => {
  const { db } = app;
  const email = freshEmail("ada");
  const phone = freshPhone();
  // Typed with stray spaces and capitals, plus fields nobody may set.
  const answer = await signUp({
    firstName: "  Adaeze ",
    lastName: "Okafor   Jnr",
    email: `  ${email.toUpperCase()} `,
    phone: ` ${phone} `,
    password: PASSWORD,
    role: "ADMIN",
    status: "SUSPENDED",
    emailVerifiedAt: "2024-01-01T00:00:00.000Z",
  });
  assert.equal(answer.status, 201, JSON.stringify(answer.json));
  assert.deepEqual(answer.json, { success: true, message: "Your PackAM account has been created.", verificationEmail: "sent" }, "nothing about the account comes back");

  const user = await db.user.findUniqueOrThrow({
    where: { email },
    select: {
      id: true, firstName: true, lastName: true, phone: true, role: true, status: true, passwordHash: true, emailVerifiedAt: true, sessionVersion: true,
      studentProfile: { select: { id: true } },
      carts: { select: { id: true } },
    },
  });
  assert.deepEqual(
    [user.firstName, user.lastName, user.phone, user.role, user.status, user.emailVerifiedAt, user.sessionVersion],
    ["Adaeze", "Okafor Jnr", phone, "STUDENT", "ACTIVE", null, 0],
    "names tidied, email lowercased and phone trimmed as login looks them up; always an active student, not yet confirmed",
  );
  assert.ok(user.studentProfile, "a student profile");
  assert.equal(user.carts.length, 1, "and a cart");
  assert.match(user.passwordHash ?? "", /^\$2[aby]\$12\$/, "bcrypt at cost 12");
  assert.ok(await bcrypt.compare(PASSWORD, user.passwordHash ?? ""), "the password works exactly as typed");

  const sent = mailTo(email);
  assert.equal(sent.length, 1, "one email, to the address as stored");
  assert.equal(sent[0].purpose, "email-verification");
  assert.equal(sent[0].subject, "Confirm your email for PackAM");
  assert.match(sent[0].text, /^Hi Adaeze,/);
  const link = sent[0].text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(link, "the email carries a link");
  const url = new URL(link);
  assert.equal(`${url.origin}${url.pathname}`, "http://packam.test/api/account/verify-email");
  const token = url.searchParams.get("token");
  assert.ok(token && /^[A-Za-z0-9_-]{43}$/.test(token), "a 43-character token in the query string");
  assert.ok(sent[0].html.includes(token), "the HTML part has the same link");
  const row = await db.accountToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
  assert.deepEqual([row.userId, row.purpose, row.email, row.usedAt], [user.id, "EMAIL_VERIFICATION", email, null]);
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 24 * HOUR, "the link works for 24 hours");

  // Opened from the inbox, signed out, the way a person would.
  const opened = await app.verify.GET(new Request(link));
  assert.deepEqual([opened.status, opened.headers.get("location")], [303, "/verify-email?status=verified"]);
  const confirmed = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { emailVerifiedAt: true } });
  assert.ok(confirmed.emailVerifiedAt, "the address is confirmed");
});

test("details the form would refuse get 400 with the problem for each field, and nothing is made", { skip }, async () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, string>]> = [
    ["nothing at all", {}, {
      firstName: "Enter your first name.",
      lastName: "Enter your last name.",
      email: "Enter your email address.",
      phone: "Enter your phone number.",
      password: "Enter a password.",
    }],
    ["a first name with a digit", details({ firstName: "Ada2" }), { firstName: "Use only letters, spaces, apostrophes, hyphens and dots in your first name." }],
    ["a last name that's too long", details({ lastName: "A".repeat(61) }), { lastName: "Keep your last name to 60 characters or fewer." }],
    ["blank names", details({ firstName: "   ", lastName: "" }), { firstName: "Enter your first name.", lastName: "Enter your last name." }],
    ["not an email", details({ email: "not-an-email" }), { email: "Enter a valid email address, like you@example.com." }],
    ["an email with a space in it", details({ email: "ada okafor@uni.example" }), { email: "Enter a valid email address, like you@example.com." }],
    ["a phone number with letters", details({ phone: "0801-CALL-NOW" }), { phone: "Enter a valid phone number, like 08012345678." }],
    ["a phone number that's too short", details({ phone: "0801" }), { phone: "Enter a valid phone number, like 08012345678." }],
    ["values that aren't text", { ...details(), firstName: 42, email: ["ada@uni.example"], phone: null, password: 12345678 }, {
      firstName: "Enter your first name.",
      email: "Enter your email address.",
      phone: "Enter your phone number.",
      password: "Enter a password.",
    }],
  ];
  for (const [name, body, fields] of cases) {
    const answer = await signUp(body);
    assert.equal(answer.status, 400, name);
    assert.deepEqual(answer.json, { success: false, message: Object.values(fields)[0], code: "INVALID_DETAILS", fields }, `${name}: every problem, the first as the message`);
    if (typeof body.email === "string") assert.equal(await accountsWith({ email: body.email.trim().toLowerCase() }), 0, name);
  }

  const unreadable = await app.register.POST(new Request("http://packam.test/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": testClientIp() },
    body: "{\"email\": ",
  }));
  const couldNotRead = { success: false, message: "PackAM couldn’t read that request. Refresh the page and try again.", code: "INVALID_REQUEST" };
  assert.deepEqual([unreadable.status, await unreadable.json()], [400, couldNotRead], "malformed JSON is a 400, not a 500");
  for (const body of [null, [], "ada@uni.example"]) {
    const answer = await signUp(body);
    assert.deepEqual([answer.status, answer.json], [400, couldNotRead], JSON.stringify(body));
  }
});

test("weak, common and personal passwords are refused in the words the form shows", { skip }, async () => {
  const person = details({ firstName: "Chidinma", lastName: "Eze", email: freshEmail("chidinma.eze") });
  const refused: Array<[string, string]> = [
    ["Short-1", "Use at least 8 characters."],
    ["abcdefghij", "Include a letter and a number or symbol."],
    ["password123", "That password is too common. Choose something harder to guess."],
    ["Chidinma-2024", "Don’t use your name or email in your password."],
    ["Mango-eze-77", "Don’t use your name or email in your password."],
    [`${person.email.split("@")[0]}!9`, "Don’t use your name or email in your password."],
    [" Fresh-mango-58", "Remove spaces from the start or end of your password."],
    ["Fresh-mango-58 ", "Remove spaces from the start or end of your password."],
    // 74 bytes: bcrypt would silently ignore everything after the 72nd.
    [`${"é".repeat(36)}-1`, "Use a shorter password (up to 72 characters)."],
  ];
  for (const [password, problem] of refused) {
    const answer = await signUp({ ...person, password });
    assert.equal(answer.status, 400, password);
    assert.deepEqual(answer.json, { success: false, message: problem, code: "INVALID_DETAILS", fields: { password: problem } }, password);
  }
  assert.equal(await accountsWith({ email: person.email }), 0, "none of them made an account");
  assert.equal((await signUp(person)).status, 201, "a good password goes through");
});

test("an email or phone number already in use gets 409 with the existing messages, however it's typed", { skip }, async () => {
  const first = details();
  const second = details();
  assert.equal((await signUp(first)).status, 201);
  assert.equal((await signUp(second)).status, 201);

  const sameEmail = await signUp(details({ email: `  ${first.email.toUpperCase()}  ` }));
  assert.deepEqual([sameEmail.status, sameEmail.json], [409, EMAIL_TAKEN]);
  const samePhone = await signUp(details({ phone: ` ${first.phone} ` }));
  assert.deepEqual([samePhone.status, samePhone.json], [409, PHONE_TAKEN]);
  const crossed = await signUp(details({ email: second.email, phone: first.phone }));
  assert.deepEqual([crossed.status, crossed.json], [409, EMAIL_TAKEN], "one account has the email, another the phone: the email is named");

  assert.equal(await accountsWith({ email: first.email }), 1);
  assert.equal(await accountsWith({ phone: first.phone }), 1);
  assert.equal(mailTo(first.email).length, 1, "only the real sign-up was emailed");
});

test("two sign-ups racing for one email or phone number: one account, and the other gets 409", { skip }, async () => {
  const { db } = app;
  // Both pass the first check together (hashing the password takes a while), so the database's unique index decides.
  const email = freshEmail("race");
  const emailRace = await Promise.all([signUp(details({ email })), signUp(details({ email }))]);
  assert.deepEqual(emailRace.map((answer) => answer.status).sort(), [201, 409], JSON.stringify(emailRace.map((answer) => answer.json)));
  assert.deepEqual(emailRace.find((answer) => answer.status === 409)?.json, EMAIL_TAKEN);
  assert.equal(await accountsWith({ email }), 1);
  const winner = await db.user.findUniqueOrThrow({ where: { email }, select: { studentProfile: { select: { id: true } }, carts: { select: { id: true } } } });
  assert.ok(winner.studentProfile, "the account that won is complete");
  assert.equal(winner.carts.length, 1);
  assert.equal(mailTo(email).length, 1, "and is the only one emailed");

  const phone = freshPhone();
  const racers = [details({ phone }), details({ phone })];
  const phoneRace = await Promise.all(racers.map((racer) => signUp(racer)));
  assert.deepEqual(phoneRace.map((answer) => answer.status).sort(), [201, 409], JSON.stringify(phoneRace.map((answer) => answer.json)));
  assert.deepEqual(phoneRace.find((answer) => answer.status === 409)?.json, PHONE_TAKEN);
  assert.equal(await accountsWith({ phone }), 1);
  const made = await Promise.all(racers.map((racer) => accountsWith({ email: racer.email })));
  assert.deepEqual(made.sort(), [0, 1], "the losing sign-up left no account behind");
});

test("cross-site requests and non-JSON bodies are refused before anything is checked or made", { skip }, async () => {
  const person = details();
  const otherSites: Array<Record<string, string>> = [
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
    { Origin: "https://evil.example" },
    { Origin: "null" },
  ];
  for (const headers of otherSites) {
    const refused = await signUp(person, headers);
    assert.deepEqual([refused.status, refused.json.code], [403, "CROSS_SITE_REQUEST"], JSON.stringify(headers));
  }
  for (const contentType of ["text/plain", "text/plain; application/json", "application/x-www-form-urlencoded"]) {
    const refused = await signUp(person, { "Content-Type": contentType });
    assert.deepEqual([refused.status, refused.json.code], [415, "JSON_REQUIRED"], contentType);
  }
  assert.equal(await accountsWith({ email: person.email }), 0, "nothing was made");
  assert.equal(mailTo(person.email).length, 0, "or sent");

  const ownPage = await signUp(person, { Origin: "http://packam.test", "Sec-Fetch-Site": "same-origin" });
  assert.equal(ownPage.status, 201, "PackAM's own sign-up page gets through");
});

test("each network gets 5 sign-up attempts an hour; refused and invalid requests don't use them up", { skip }, async () => {
  const existing = details();
  assert.equal((await signUp(existing)).status, 201);
  const network = { "x-real-ip": testClientIp() };

  // Answered before anything is counted.
  assert.equal((await signUp(details(), { ...network, "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await signUp(details(), { ...network, "Content-Type": "text/plain" })).status, 415);
  for (let i = 0; i < 3; i += 1) assert.equal((await signUp(details({ phone: "12" }), network)).status, 400);

  // Five real attempts (the email is taken, so they make nothing), then the limit.
  for (let i = 0; i < 5; i += 1) assert.equal((await signUp(details({ email: existing.email }), network)).status, 409, `attempt ${i + 1}`);
  const late = details();
  const limited = await signUpKeepingHeaders(late, network);
  assert.equal(limited.status, 429);
  assert.deepEqual([limited.json.success, limited.json.message, limited.json.code], [false, "Too many attempts. Please try again later.", "RATE_LIMITED"]);
  assert.ok(Number(limited.retryAfter) >= 1, "Retry-After says when to try again");
  assert.equal(limited.json.retryAfterSeconds, Number(limited.retryAfter));
  assert.equal(await accountsWith({ email: late.email }), 0);

  assert.equal((await signUp(late)).status, 201, "another network isn't affected");
});

test("when email can't go out, the account is still made and the answer says so, never logging the address", { skip }, async (t) => {
  const { db } = app;
  try {
    app.email.setTestEmailMode("not-configured");
    const quiet = details();
    const unconfigured = await signUp(quiet);
    assert.deepEqual([unconfigured.status, unconfigured.json.verificationEmail], [201, "not-configured"]);
    const quietUser = await db.user.findUniqueOrThrow({ where: { email: quiet.email }, select: { id: true, status: true } });
    assert.equal(quietUser.status, "ACTIVE");
    assert.equal(await db.accountToken.count({ where: { userId: quietUser.id } }), 0, "no link is made that can't be sent");

    const logged: string[] = [];
    const capture = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
    t.mock.method(console, "error", capture);
    t.mock.method(console, "warn", capture);
    app.email.setTestEmailMode("failing");
    const unlucky = details();
    const failed = await signUp(unlucky);
    assert.deepEqual([failed.status, failed.json.verificationEmail], [201, "failed"], "a failed send doesn't undo the sign-up");
    assert.equal(await accountsWith({ email: unlucky.email }), 1);
    assert.equal(mailTo(unlucky.email).length, 0);
    assert.ok(logged.some((line) => line.includes("email-verification")), "the failure is logged by purpose");
    assert.ok(!logged.some((line) => line.includes(unlucky.email) || line.includes(unlucky.phone) || line.includes("token=")), "never with the address, the phone number or the link");
  } finally {
    app.email.setTestEmailMode("memory");
  }
});
