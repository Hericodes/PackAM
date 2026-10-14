/**
 * Shared setup for database-backed tests (`npm run test:db`). Import this FIRST in a *.db-test.ts file.
 *
 * Safety:
 * - Runs only when TEST_DATABASE_URL is set and passes assessTestDatabaseUrl (never the app database).
 * - When tests are skipped, DATABASE_URL is replaced by an unroutable placeholder so nothing can
 *   reach the application database by accident.
 * - Cleanup deletes only rows created through these fixtures.
 *
 * Payment boundary: no money moves and nothing calls OPay. `trustedTestVerifiedPayment` builds the
 * same VerifiedProviderPayment value the OPay webhook passes to completeVerifiedPayment after it has
 * verified a transaction, marked with an unmistakable TEST- provider reference. It exists only in
 * this test harness; the application exposes no simulator endpoint.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { assessTestDatabaseUrl } from "../lib/printing/test-database-guard";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const verdict = assessTestDatabaseUrl(
  testDatabaseUrl,
  [process.env.DATABASE_URL, process.env.DIRECT_URL],
  { disposableConfirmed: process.env.PACKAM_TEST_DATABASE_IS_DISPOSABLE === "1" },
);
// Unset: skip. Set but unsafe: fail loudly so a refusal can never be mistaken for a pass.
if (testDatabaseUrl && !verdict.ok) throw new Error(`Refusing to run database tests: ${verdict.reason}`);
if (process.env.NODE_ENV === "production") throw new Error("Refusing to run database tests with NODE_ENV=production.");

export const dbTestSkip: string | false = verdict.ok ? false : verdict.reason;
export const expectedDatabaseName = testDatabaseUrl && verdict.ok ? decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1)) : "";
// db.ts reads DATABASE_URL at import time; app modules must be imported after this line runs.
process.env.DATABASE_URL = verdict.ok ? testDatabaseUrl! : "postgresql://skipped:skipped@127.0.0.1:1/packam_tests_skipped";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.PACKAM_DB_TEST = "1";

// registerHooks exists from Node 22.15; the project's @types/node predates it.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { createRequire, registerHooks } = nodeModule as typeof nodeModule & {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (specifier: string, context: unknown) => ResolveResult): ResolveResult }): void;
};
const requireFromHere = createRequire(import.meta.url);
// Next resolves "server-only" to its empty module under the react-server condition; mirror that.
const serverOnlyUrl = pathToFileURL(requireFromHere.resolve("next/dist/compiled/server-only/empty.js")).href;
const authStubUrl = pathToFileURL(requireFromHere.resolve("./auth-session.ts")).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: serverOnlyUrl, shortCircuit: true };
    const resolved = next(specifier, context);
    // Request handlers read the signed-in user through src/auth.ts; tests choose the user instead.
    if (/\/src\/auth\.(ts|js)$/.test(resolved.url)) return { url: authStubUrl, shortCircuit: true };
    return resolved;
  },
});

type Db = typeof import("../lib/db").db;
let dbInstance: Db | null = null;

export async function testDb() {
  if (dbTestSkip) throw new Error(`Database tests are skipped: ${dbTestSkip}`);
  if (!dbInstance) {
    const { db } = await import("../lib/db");
    // Confirm the live connection really is the test database before any fixture is written.
    const [connected] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (connected?.name !== expectedDatabaseName) {
      await db.$disconnect();
      throw new Error("Connected database does not match TEST_DATABASE_URL; refusing to continue.");
    }
    dbInstance = db;
    setSession = (await import("./auth-session")).setTestSession;
  }
  return dbInstance;
}

type SessionUser = { userId: string; role: "STUDENT" | "RUNNER" | "ADMIN" } | null;
let setSession: typeof import("./auth-session").setTestSession | null = null;

/** Signs in the given test user. Synchronous after testDb(), so races can give each request its own user. */
export function signInAs(user: SessionUser) {
  if (!setSession) throw new Error("Call testDb() before signInAs().");
  setSession(user ? { id: user.userId, role: user.role } : null);
}

/** Invokes `call` as `user`. The handler reads the session synchronously when it starts. */
export function asUser<T>(user: SessionUser, call: () => Promise<T>) {
  signInAs(user);
  return call();
}

const created = { users: [] as string[], products: [] as string[], categories: [] as string[], vendors: [] as string[] };
export const runTag = randomUUID().slice(0, 8);

export async function createTestUser(
  role: "STUDENT" | "RUNNER" | "ADMIN",
  runnerProfile?: { isVerified: boolean; isAvailable: boolean },
) {
  const db = await testDb();
  const user = await db.user.create({
    data: {
      email: `${role.toLowerCase()}-${randomUUID()}@packam.test`,
      role,
      firstName: `Test${role[0]}${runTag}`,
      ...(role === "STUDENT" ? { studentProfile: { create: {} } } : {}),
      ...(runnerProfile ? { runnerProfile: { create: runnerProfile } } : {}),
    },
    select: { id: true, runnerProfile: { select: { id: true } } },
  });
  created.users.push(user.id);
  return { userId: user.id, runnerId: user.runnerProfile?.id ?? "", role };
}

export async function createTestCatalogue(products: Array<{ name: string; price: number }>) {
  const db = await testDb();
  const category = await db.category.create({ data: { name: `Test ${runTag}`, slug: `test-${runTag}-${randomUUID().slice(0, 6)}` } });
  created.categories.push(category.id);
  const rows = [];
  for (const product of products) {
    const row = await db.product.create({
      data: { categoryId: category.id, name: `${product.name} ${runTag}`, slug: `p-${randomUUID()}`, customerPrice: product.price },
      select: { id: true, name: true, customerPrice: true },
    });
    created.products.push(row.id);
    rows.push(row);
  }
  return { categoryId: category.id, categorySlug: category.slug, products: rows };
}

export async function createTestVendor(name = "Test shop") {
  const db = await testDb();
  const vendor = await db.vendor.create({ data: { name: `${name} ${runTag}` }, select: { id: true } });
  created.vendors.push(vendor.id);
  return vendor;
}

export async function createTestLocation(userId: string) {
  const db = await testDb();
  return db.savedLocation.create({
    data: { userId, label: "Hall test", address: "Room 1, Test Hall, OOU", instructions: "Call on arrival" },
    select: { id: true },
  });
}

/** Builds the value the OPay webhook hands to completeVerifiedPayment after provider verification. */
export function trustedTestVerifiedPayment(attempt: { transactionReference: string | null; amount: number; currency: string }) {
  if (dbTestSkip || process.env.PACKAM_DB_TEST !== "1" || process.env.NODE_ENV === "production") {
    throw new Error("Test payment fixtures are only available in an enabled database test run.");
  }
  if (!attempt.transactionReference) throw new Error("Payment attempt has no reference.");
  return {
    transactionReference: attempt.transactionReference,
    providerReference: `TEST-NO-MONEY-${randomUUID()}`,
    provider: "OPAY" as const,
    amount: attempt.amount,
    currency: attempt.currency,
    status: "SUCCESS" as const,
  };
}

/** Calls a Next route handler as the currently signed-in test user. */
export async function callRoute(
  handler: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response,
  options: { method?: string; path?: string; body?: unknown; params?: { id: string }; headers?: Record<string, string> } = {},
) {
  const request = new Request(`http://packam.test${options.path ?? "/"}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const response = await handler(request, { params: Promise.resolve(options.params ?? { id: "" }) });
  const text = await response.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json: json as Record<string, unknown> & { error?: string } };
}

/** Deletes only rows created by this test process, in dependency order. */
export async function cleanupTestData() {
  if (dbTestSkip || !dbInstance) return;
  const db = dbInstance;
  // Other test files may still be running against the same database; retry deadlocks.
  const { retrySerializable } = await import("../lib/db-retry");
  await retrySerializable(() => deleteCreatedRows(db), { attempts: 8, baseDelayMs: 50 });
  await db.$disconnect();
}

async function deleteCreatedRows(db: Db) {
  const users = { in: created.users };
  // Offers go to every eligible runner, so our runners may hold assignments on other tests' work.
  const runners = { in: (await db.runnerProfile.findMany({ where: { userId: users }, select: { id: true } })).map((r) => r.id) };
  // Take our runners off duty first so no new offers can land on them mid-cleanup.
  await db.runnerProfile.updateMany({ where: { userId: users }, data: { isAvailable: false, isVerified: false } });
  await db.notification.deleteMany({ where: { userId: users } });
  await db.payment.deleteMany({ where: { userId: users } });
  await db.printJob.deleteMany({ where: { userId: users } });
  await db.incident.deleteMany({ where: { order: { userId: users } } });
  await db.order.deleteMany({ where: { userId: users } });
  await db.supportCase.deleteMany({ where: { userId: users } });
  await db.productRequest.deleteMany({ where: { userId: users } });
  await db.auditLog.deleteMany({ where: { actorId: users } });
  await db.runnerAssignment.deleteMany({ where: { runnerId: runners } });
  await db.orderItemSourcing.deleteMany({ where: { reportedByRunnerId: runners } });
  await db.incident.deleteMany({ where: { reportedById: users } });
  await db.productSource.deleteMany({ where: { productId: { in: created.products } } });
  await db.cart.deleteMany({ where: { userId: users } });
  await db.product.deleteMany({ where: { id: { in: created.products } } });
  await db.category.deleteMany({ where: { id: { in: created.categories } } });
  await db.vendor.deleteMany({ where: { id: { in: created.vendors } } });
  await db.user.deleteMany({ where: { id: users } });
}
