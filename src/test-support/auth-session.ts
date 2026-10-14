/**
 * Test-only replacement for src/auth.ts, wired in by src/test-support/db-harness.ts through a
 * Node resolve hook. It is never imported by application code and refuses to load anywhere
 * except an explicitly enabled database test run.
 */
if (process.env.PACKAM_DB_TEST !== "1" || process.env.NODE_ENV === "production") {
  throw new Error("The test auth session module can only load inside an enabled database test run.");
}

type TestUser = { id: string; role: "STUDENT" | "RUNNER" | "ADMIN"; email?: string };
const store = globalThis as typeof globalThis & { __PACKAM_TEST_SESSION__?: { user: TestUser } | null };

export function setTestSession(user: TestUser | null) {
  store.__PACKAM_TEST_SESSION__ = user ? { user } : null;
}

export async function auth() {
  return store.__PACKAM_TEST_SESSION__ ?? null;
}

export async function signIn(): Promise<never> {
  throw new Error("signIn is unavailable in database tests.");
}

export async function signOut(): Promise<never> {
  throw new Error("signOut is unavailable in database tests.");
}

export const handlers = {
  GET: () => new Response(null, { status: 404 }),
  POST: () => new Response(null, { status: 404 }),
};
