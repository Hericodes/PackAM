/**
 * The scheduled account clean-up against a disposable database: deleted accounts' print files are retried until they
 * leave storage (never an active or suspended account's, nor an unfinished job's), and emailed-link rows go 30 days
 * after they expire. Storage is a fake; nothing reaches Cloudinary. Run with `npm run test:db` (see
 * src/test-support/db-harness.ts for the safety rules).
 */
import { callRoute, cleanupTestData, createTestUser, dbTestSkip as skip, testDb } from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { AccountTokenPurpose } from "@prisma/client";
import { DELETED_ACCOUNT_EMAIL_SUFFIX, deletedAccountEmail } from "./deletion-policy";
import { hashToken } from "./tokens";

// No Cloudinary credentials in tests: nothing here may reach real document storage.
process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "packam-test-cloud";
delete process.env.CLOUDINARY_API_SECRET;

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  housekeeping: typeof import("./housekeeping");
  tokens: typeof import("./account-tokens");
  deletion: typeof import("./deletion");
  runDue: typeof import("../../app/api/internal/fulfilment/run-due/route");
};
let app: App;

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [housekeeping, tokens, deletion, runDue] = await Promise.all([
    import("./housekeeping"),
    import("./account-tokens"),
    import("./deletion"),
    import("../../app/api/internal/fulfilment/run-due/route"),
  ]);
  app = { db, housekeeping, tokens, deletion, runDue };
});
after(cleanupTestData);

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number, from = new Date()) => new Date(from.getTime() - days * DAY);

type Account = "deleted" | "suspended" | "active";
/** A student whose account is deleted (anonymised the way deletion does), suspended (deactivated only) or active. */
async function studentWhoIs(state: Account) {
  const { userId } = await createTestUser("STUDENT");
  if (state === "deleted") await app.db.user.update({ where: { id: userId }, data: { status: "DEACTIVATED", email: deletedAccountEmail(userId), firstName: null } });
  if (state === "suspended") await app.db.user.update({ where: { id: userId }, data: { status: "DEACTIVATED" } });
  return userId;
}

async function storedDocument(userId: string, status: "DELIVERED" | "CANCELLED" | "PRINTING") {
  const job = await app.db.printJob.create({ data: { userId, status } });
  return app.db.printDocument.create({
    data: { printJobId: job.id, uploadedById: userId, publicId: `packam/print-jobs/test-${randomUUID()}.pdf`, originalFileName: "synthetic-sweep-test.pdf", mimeType: "application/pdf", fileSize: 48_000, pageCount: 2 },
    select: { id: true, publicId: true },
  });
}

const deletedAt = async (id: string) => (await app.db.printDocument.findUniqueOrThrow({ where: { id }, select: { deletedAt: true } })).deletedAt;

/** Every file a fake storage was asked to remove must belong to a finished job of a deleted account. */
async function assertOnlyDeletedAccountFiles(publicIds: string[]) {
  const unique = [...new Set(publicIds)];
  const documents = await app.db.printDocument.findMany({
    where: { publicId: { in: unique } },
    select: { printJob: { select: { status: true, user: { select: { status: true, email: true } } } } },
  });
  assert.equal(documents.length, unique.length);
  for (const { printJob } of documents) {
    assert.equal(printJob.user.status, "DEACTIVATED");
    assert.ok(printJob.user.email.endsWith(DELETED_ACCOUNT_EMAIL_SUFFIX), "only accounts deleted through the deletion flow");
    assert.notEqual(printJob.status, "PRINTING");
  }
}

test("the sweep retries deleted accounts' files until they leave storage, and touches nobody else's", { skip }, async () => {
  const { deletion } = app;
  const deletedId = await studentWhoIs("deleted");
  const delivered = await storedDocument(deletedId, "DELIVERED");
  const cancelled = await storedDocument(deletedId, "CANCELLED");
  const unfinished = await storedDocument(deletedId, "PRINTING");
  const suspended = await storedDocument(await studentWhoIs("suspended"), "DELIVERED");
  const active = await storedDocument(await studentWhoIs("active"), "DELIVERED");

  const asked: string[] = [];
  let storageUp = false;
  const storage = async (publicId: string) => {
    asked.push(publicId);
    if (publicId === cancelled.publicId && !storageUp) throw new Error("Storage is unavailable.");
  };

  const first = await deletion.sweepDeletedAccountDocuments(1000, storage);
  assert.ok(first.removed >= 1 && first.failed >= 1, JSON.stringify(first));
  assert.ok(await deletedAt(delivered.id), "removed and marked deleted; the record stays");
  assert.equal(await deletedAt(cancelled.id), null, "a failed removal waits for the next run");

  storageUp = true;
  await deletion.sweepDeletedAccountDocuments(1000, storage);
  assert.ok(await deletedAt(cancelled.id), "the next run finishes it");
  assert.equal(asked.filter((id) => id === delivered.publicId).length, 1, "a removed file is never asked for again");

  for (const kept of [unfinished, suspended, active]) {
    assert.equal(await deletedAt(kept.id), null);
    assert.ok(!asked.includes(kept.publicId), "an unfinished job's, a suspended account's and an active account's files are never touched");
  }
  await assertOnlyDeletedAccountFiles(asked);
});

test("the sweep takes a bounded batch, oldest first", { skip }, async () => {
  const deletedId = await studentWhoIs("deleted");
  const older = await storedDocument(deletedId, "DELIVERED");
  const newer = await storedDocument(deletedId, "DELIVERED");
  // Older than anything another test leaves behind, so this batch of one is exactly `older`.
  await app.db.printDocument.update({ where: { id: older.id }, data: { uploadedAt: daysAgo(400) } });
  await app.db.printDocument.update({ where: { id: newer.id }, data: { uploadedAt: daysAgo(399) } });
  const asked: string[] = [];
  assert.deepEqual(await app.deletion.sweepDeletedAccountDocuments(1, async (publicId) => { asked.push(publicId); }), { removed: 1, failed: 0 });
  assert.deepEqual(asked, [older.publicId]);
  assert.equal(await deletedAt(newer.id), null, "the rest waits for the next run");
});

test("links are deleted 30 days after they expire, not before, a bounded batch at a time", { skip }, async () => {
  const { db, tokens } = app;
  const { userId } = await createTestUser("STUDENT");
  const now = new Date();
  const issue = (purpose: AccountTokenPurpose, at: Date) => tokens.issueAccountToken(db, { userId, purpose, email: `link-${randomUUID()}@packam.test`, now: at });
  const exists = async (token: string) => (await db.accountToken.count({ where: { tokenHash: hashToken(token) } })) === 1;
  // Start from a table with nothing already due, so the batch of one below is this test's oldest link.
  await tokens.purgeExpiredAccountTokens(db, { now, take: 10_000 });

  // A reset link lives 30 minutes, a confirmation link 24 hours.
  const oldest = await issue("PASSWORD_RESET", daysAgo(40, now));
  const old = await issue("PASSWORD_RESET", daysAgo(35, now));
  const usedLongAgo = await issue("EMAIL_CHANGE", daysAgo(32, now));
  await tokens.consumeAccountToken(db, { token: usedLongAgo, purpose: "EMAIL_CHANGE", now: daysAgo(32, now) });
  const recentlyExpired = await issue("EMAIL_VERIFICATION", daysAgo(29, now));
  const live = await issue("EMAIL_CHANGE", now);

  assert.equal(await tokens.purgeExpiredAccountTokens(db, { now, take: 1 }), 1, "one batch of one");
  assert.equal(await exists(oldest), false, "oldest first");
  assert.equal(await exists(old), true);

  assert.ok((await tokens.purgeExpiredAccountTokens(db, { now })) >= 2);
  for (const gone of [old, usedLongAgo]) assert.equal(await exists(gone), false, "expired over 30 days ago, used or not");
  for (const kept of [recentlyExpired, live]) assert.equal(await exists(kept), true, "kept: an old link still reads as expired, not invalid");
  assert.deepEqual(await tokens.peekAccountToken(db, { token: recentlyExpired, purpose: "EMAIL_VERIFICATION", now }), { ok: false, reason: "expired" });
  assert.equal(await tokens.purgeExpiredAccountTokens(db, { now }), 0, "safe to repeat");
});

test("the scheduled run does the clean-up after its dispatch work, without changing the run's result", { skip }, async (t) => {
  const { db } = app;
  const CRON_SECRET = "test-cron-secret-housekeeping-0123456789";
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = CRON_SECRET;
  // The run holds a one-minute lease in the database; clear it so this call runs and the dispatch tests' calls do too.
  const lease = { key: createHash("sha256").update("fulfilment-run-due").digest("hex") };
  t.after(async () => {
    await db.rateLimitBucket.deleteMany({ where: lease });
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  });
  await db.rateLimitBucket.deleteMany({ where: lease });

  const deletedId = await studentWhoIs("deleted");
  const document = await storedDocument(deletedId, "DELIVERED");
  const { userId } = await createTestUser("STUDENT");
  const expired = await app.tokens.issueAccountToken(db, { userId, purpose: "PASSWORD_RESET", email: `link-${randomUUID()}@packam.test`, now: daysAgo(31) });

  // No storage credentials here, so the real document removal fails and is counted, never reaching Cloudinary.
  const errors = t.mock.method(console, "error", () => {});
  const run = await callRoute(app.runDue.POST, { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.ok("orders" in run.json && "printJobs" in run.json, "the answer is the dispatch result");
  assert.equal(await db.accountToken.count({ where: { tokenHash: hashToken(expired) } }), 0, "the expired link is gone");
  assert.equal(await deletedAt(document.id), null, "a file storage didn't confirm stays, for the next run");
  const logged = errors.mock.calls.map((call) => call.arguments.map(String).join(" "));
  assert.ok(logged.some((line) => line.startsWith("DELETED ACCOUNT DOCUMENT CLEANUP ERROR: Error")), "the failure is logged by error name only");
  assert.ok(!logged.some((line) => line.includes(document.publicId)), "never the file's name");
});
