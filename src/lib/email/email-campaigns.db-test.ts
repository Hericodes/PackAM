/**
 * Automated email against a disposable database, with the in-memory outbox (no real mail):
 * - the good-morning email reaches every subscribed student (confirmed address or not; names only once confirmed),
 *   once a day, inside its window only;
 * - the reminder skips students who ordered today; announcements reach everyone subscribed once, then finish;
 * - an order's status change queues an order update that the scheduler sends;
 * - one-tap and page unsubscribes, Settings switches, and retries after a failed provider call.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts for the safety rules).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestLocation,
  createTestUser,
  dbTestSkip as skip,
  signInAs,
  testDb,
  trustedTestVerifiedPayment,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";

process.env.AUTH_SECRET = process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16 ? process.env.AUTH_SECRET : "email-campaign-test-secret-123456";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  campaigns: typeof import("./campaigns");
  email: typeof import("./index");
  tokens: typeof import("./unsubscribe");
  unsubscribe: typeof import("../../app/api/email/unsubscribe/route");
  preferences: typeof import("../../app/api/account/email-preferences/route");
  broadcasts: typeof import("../../app/api/admin/emails/broadcasts/route");
  schedule: typeof import("../../app/api/admin/emails/schedule/route");
  cart: typeof import("../../app/api/cart/route");
  payments: typeof import("../payments/payment-lifecycle");
};
let app: App;
let savedSchedules: Array<{ kind: "MORNING" | "REMINDER" | "ORDER_UPDATE" | "ANNOUNCEMENT"; enabled: boolean }> = [];

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [campaigns, email, tokens, unsubscribe, preferences, broadcasts, schedule, cart, payments] = await Promise.all([
    import("./campaigns"),
    import("./index"),
    import("./unsubscribe"),
    import("../../app/api/email/unsubscribe/route"),
    import("../../app/api/account/email-preferences/route"),
    import("../../app/api/admin/emails/broadcasts/route"),
    import("../../app/api/admin/emails/schedule/route"),
    import("../../app/api/cart/route"),
    import("../payments/payment-lifecycle"),
  ]);
  app = { db, campaigns, email, tokens, unsubscribe, preferences, broadcasts, schedule, cart, payments };
  savedSchedules = await db.emailSchedule.findMany({ select: { kind: true, enabled: true } });
});
afterEach(() => {
  if (skip) return;
  app.email.setTestEmailMode("memory");
  app.email.clearTestOutbox();
});
after(async () => {
  if (!skip) {
    // Put the global switches back exactly as they were.
    for (const row of savedSchedules) await app.db.emailSchedule.update({ where: { kind: row.kind }, data: { enabled: row.enabled } });
  }
  await cleanupTestData();
});

const lagos = (iso: string) => new Date(`${iso}+01:00`);

async function confirmedStudent() {
  const student = await createTestUser("STUDENT");
  const row = await app.db.user.update({ where: { id: student.userId }, data: { emailVerifiedAt: new Date() }, select: { email: true } });
  return { ...student, email: row.email };
}

async function setSwitch(kind: "MORNING" | "REMINDER" | "ORDER_UPDATE", enabled: boolean) {
  await app.db.emailSchedule.upsert({ where: { kind }, create: { kind, enabled }, update: { enabled } });
}

/** Runs the scheduler at a campus time with the real ordering hours (the harness otherwise runs "always open"). */
async function runAt(iso: string) {
  const previous = { hours: process.env.ORDERING_HOURS, days: process.env.ORDERING_DAYS };
  process.env.ORDERING_HOURS = "08:00-17:00";
  process.env.ORDERING_DAYS = "MON-FRI";
  try {
    return await app.campaigns.runEmailCampaigns(lagos(iso));
  } finally {
    process.env.ORDERING_HOURS = previous.hours;
    process.env.ORDERING_DAYS = previous.days;
  }
}

const sentTo = (address: string) => app.email.testOutbox().filter((message) => message.to === address);

test("the good-morning email goes once a day, inside its window, to every subscribed student, confirmed email or not", { skip }, async () => {
  const subscribed = await confirmedStudent();
  const optedOut = await confirmedStudent();
  await app.db.emailPreference.create({ data: { userId: optedOut.userId, morning: false } });
  const unconfirmed = await createTestUser("STUDENT");
  const unconfirmedEmail = (await app.db.user.findUniqueOrThrow({ where: { id: unconfirmed.userId }, select: { email: true } })).email;
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  const runnerEmail = (await app.db.user.update({ where: { id: runner.userId }, data: { emailVerifiedAt: new Date() }, select: { email: true } })).email;
  await setSwitch("MORNING", true);

  await runAt("2026-11-09T07:00:00");
  assert.equal(sentTo(subscribed.email).length, 0, "not before 7:30am");
  await runAt("2026-11-14T08:00:00");
  assert.equal(sentTo(subscribed.email).length, 0, "not on Saturday");

  await runAt("2026-11-09T07:45:00");
  const [morning] = sentTo(subscribed.email);
  assert.ok(morning, "the subscribed student got it");
  assert.match(morning.subject, /☀️/);
  assert.match(morning.text, /We’re taking orders today from 8am to 5pm\./);
  assert.match(morning.headers?.["List-Unsubscribe"] ?? "", /^<http:\/\/packam\.test\/api\/email\/unsubscribe\?t=/);
  assert.equal(morning.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(morning.text, /^Hi Test/, "a confirmed address is greeted by name");
  const [unconfirmedMorning] = sentTo(unconfirmedEmail);
  assert.ok(unconfirmedMorning, "an unconfirmed student gets it too");
  assert.match(unconfirmedMorning.text, /^Hi there,/, "but not by the name the account typed");
  for (const address of [optedOut.email, runnerEmail]) assert.equal(sentTo(address).length, 0, address);
  assert.equal(await app.db.emailDelivery.count({ where: { userId: subscribed.userId, kind: "MORNING", key: "2026-11-09", status: "SENT" } }), 1);

  await runAt("2026-11-09T08:30:00");
  assert.equal(sentTo(subscribed.email).length, 1, "once a day, however many runs");

  await setSwitch("MORNING", false);
  await runAt("2026-11-10T07:45:00");
  assert.equal(sentTo(subscribed.email).length, 1, "switched off: nothing on Tuesday");
});

test("the reminder goes at 3:30pm only to students who haven't ordered today", { skip }, async () => {
  const idle = await confirmedStudent();
  const ordered = await confirmedStudent();
  await app.db.order.create({ data: { userId: ordered.userId, status: "FINDING_RUNNER", subtotal: 1000, deliveryFee: 200, total: 1200, deliveryAddress: "Test Hall", createdAt: lagos("2026-11-11T10:00:00") } });
  await setSwitch("REMINDER", true);
  try {
    await runAt("2026-11-11T15:35:00");
    assert.equal(sentTo(idle.email).length, 1);
    assert.match(sentTo(idle.email)[0].subject, /Ordering closes at 5pm today/);
    assert.equal(sentTo(ordered.email).length, 0, "already ordered today");
  } finally {
    await setSwitch("REMINDER", false);
  }
});

test("an announcement reaches each subscribed student once, then finishes", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  const reader = await confirmedStudent();
  const noNews = await confirmedStudent();
  await app.db.emailPreference.create({ data: { userId: noNews.userId, announcements: false } });

  signInAs(admin);
  const created = await callRoute(app.broadcasts.POST, { method: "POST", path: "/api/admin/emails/broadcasts", body: { subject: "New shop on PackAM", body: "Mama Put is here.\n\nOrder today!", buttonLabel: "See the menu", buttonUrl: "https://www.packam.app/food" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = (created.json.broadcast as { id: string }).id;

  for (let run = 0; run < 5; run += 1) {
    await runAt("2026-11-12T19:00:00"); // any time: announcements don't wait for ordering hours
    if ((await app.db.emailBroadcast.findUniqueOrThrow({ where: { id }, select: { status: true } })).status === "SENT") break;
  }
  assert.equal((await app.db.emailBroadcast.findUniqueOrThrow({ where: { id }, select: { status: true } })).status, "SENT");
  const [email] = sentTo(reader.email);
  assert.equal(email?.subject, "New shop on PackAM");
  assert.match(email!.html, /Mama Put is here\./);
  assert.match(email!.text, /Stop news and offers:/);
  assert.equal(sentTo(noNews.email).length, 0, "news and offers switched off");
  await runAt("2026-11-12T19:05:00");
  assert.equal(sentTo(reader.email).length, 1, "never twice");

  const student = await createTestUser("STUDENT");
  signInAs(student);
  assert.equal((await callRoute(app.broadcasts.POST, { method: "POST", body: { subject: "x", body: "y" } })).status, 403, "students can't announce");
});

test("an order's status change queues the same update by email, sent by the next run", { skip }, async () => {
  const buyer = await confirmedStudent();
  const { products } = await createTestCatalogue([{ name: "Email order item", price: 800 }]);
  signInAs(buyer);
  assert.equal((await callRoute(app.cart.POST, { method: "POST", body: { productId: products[0].id, quantity: 1 } })).status, 200);
  const location = await createTestLocation(buyer.userId);
  signInAs(buyer);
  const attempt = await app.payments.createPaymentAttempt("OPAY", location.id, randomUUID());
  const { orderId } = await app.payments.completeVerifiedPayment(trustedTestVerifiedPayment(attempt));

  const queued = await app.db.emailDelivery.findMany({ where: { userId: buyer.userId, kind: "ORDER_UPDATE" }, select: { status: true, payload: true } });
  assert.equal(queued.length, 1, "one email for 'Order confirmed'");
  assert.equal(queued[0].status, "PENDING");
  assert.equal((queued[0].payload as { orderId: string }).orderId, orderId);

  await runAt("2026-11-12T12:00:00");
  const [update] = sentTo(buyer.email);
  assert.match(update?.subject ?? "", /^Order confirmed · PackAM order [A-Z0-9]{8}$/);
  assert.match(update!.html, new RegExp(`/orders/${orderId}`));
});

test("one-tap unsubscribe stops that kind; the page can stop everything; a tampered link does nothing", { skip }, async () => {
  const student = await confirmedStudent();
  const secret = process.env.AUTH_SECRET!;
  const morningToken = app.tokens.signUnsubscribeToken(secret, student.userId, "morning");

  // A mail app's one-tap unsubscribe: form body, token in the URL, no sign-in.
  signInAs(null);
  const oneTap = await app.unsubscribe.POST(new Request(`http://packam.test/api/email/unsubscribe?t=${encodeURIComponent(morningToken)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
  assert.equal(oneTap.status, 200);
  assert.deepEqual(await app.db.emailPreference.findUniqueOrThrow({ where: { userId: student.userId }, select: { morning: true, reminders: true, announcements: true, orderUpdates: true } }), { morning: false, reminders: true, announcements: true, orderUpdates: true });

  const all = await callRoute(app.unsubscribe.POST, { method: "POST", path: "/api/email/unsubscribe", body: { token: morningToken, all: true } });
  assert.equal(all.status, 200);
  assert.deepEqual(await app.db.emailPreference.findUniqueOrThrow({ where: { userId: student.userId }, select: { morning: true, reminders: true, announcements: true, orderUpdates: true } }), { morning: false, reminders: false, announcements: false, orderUpdates: false });

  const other = await confirmedStudent();
  const forged = `${Buffer.from(`${other.userId}:morning`).toString("base64url")}.${morningToken.split(".")[1]}`;
  assert.equal((await callRoute(app.unsubscribe.POST, { method: "POST", body: { token: forged } })).status, 400);
  assert.equal(await app.db.emailPreference.count({ where: { userId: other.userId } }), 0, "someone else's emails are untouched");
});

test("students switch kinds on and off in Settings; runners can't", { skip }, async () => {
  const student = await confirmedStudent();
  signInAs(student);
  const saved = await callRoute(app.preferences.PATCH, { method: "PATCH", path: "/api/account/email-preferences", body: { reminders: false } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.preferences, { morning: true, reminders: false, announcements: true, orderUpdates: true });
  assert.equal((await callRoute(app.preferences.PATCH, { method: "PATCH", body: { reminders: "no" } })).status, 400);
  const runner = await createTestUser("RUNNER", { isVerified: true, isAvailable: false });
  signInAs(runner);
  assert.equal((await callRoute(app.preferences.PATCH, { method: "PATCH", body: { reminders: false } })).status, 403);
});

test("a failed provider call is retried on later runs, then marked failed after three tries", { skip }, async () => {
  const student = await confirmedStudent();
  await setSwitch("MORNING", true);
  try {
    app.email.setTestEmailMode("failing");
    for (const time of ["07:35", "07:40", "07:45"]) await runAt(`2026-11-13T${time}:00`);
    const row = await app.db.emailDelivery.findUniqueOrThrow({ where: { userId_kind_key: { userId: student.userId, kind: "MORNING", key: "2026-11-13" } }, select: { status: true, attempts: true } });
    assert.deepEqual(row, { status: "FAILED", attempts: 3 });
    app.email.setTestEmailMode("memory");
    await runAt("2026-11-13T07:50:00");
    assert.equal(sentTo(student.email).length, 0, "a failed email isn't sent again later the same day");
  } finally {
    await setSwitch("MORNING", false);
  }
});

test("admins switch the scheduled emails on and off, and each change is audited", { skip }, async () => {
  const admin = await createTestUser("ADMIN");
  signInAs(admin);
  const on = await callRoute(app.schedule.PATCH, { method: "PATCH", path: "/api/admin/emails/schedule", body: { kind: "REMINDER", enabled: true } });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  const off = await callRoute(app.schedule.PATCH, { method: "PATCH", body: { kind: "REMINDER", enabled: false } });
  assert.equal(off.status, 200);
  assert.equal(await app.db.auditLog.count({ where: { actorId: admin.userId, action: "EMAIL_SCHEDULE_UPDATED" } }), 2);
  assert.equal((await callRoute(app.schedule.PATCH, { method: "PATCH", body: { kind: "ANNOUNCEMENT", enabled: true } })).status, 400, "announcements have no switch");
});

