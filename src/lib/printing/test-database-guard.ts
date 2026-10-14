/**
 * Decides whether a URL is safe for destructive database tests. Pure, so it is unit-tested.
 * Reasons never include the URL itself, so credentials cannot leak into test output.
 */

type Identity = { host: string; port: string; database: string };

function identityOf(value: string): Identity | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
  const labels = url.hostname.toLowerCase().split(".");
  // Neon (and similar) expose the same database through a "-pooler" host.
  labels[0] = labels[0].replace(/-pooler$/, "");
  return {
    host: labels.join("."),
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
  };
}

export type TestDatabaseVerdict = { ok: true } | { ok: false; reason: string };

export function assessTestDatabaseUrl(
  testUrl: string | undefined,
  applicationUrls: Array<string | undefined>,
  options: { disposableConfirmed?: boolean } = {},
): TestDatabaseVerdict {
  if (!testUrl) return { ok: false, reason: "TEST_DATABASE_URL is not set." };
  const test = identityOf(testUrl);
  if (!test) return { ok: false, reason: "TEST_DATABASE_URL is not a valid postgres:// URL." };

  for (const candidate of applicationUrls) {
    if (!candidate) continue;
    if (candidate.trim() === testUrl.trim()) {
      return { ok: false, reason: "TEST_DATABASE_URL is identical to an application database URL." };
    }
    const app = identityOf(candidate);
    if (app && app.host === test.host && app.database === test.database) {
      return { ok: false, reason: "TEST_DATABASE_URL points at the same host and database as the application." };
    }
  }

  if (!/test/i.test(test.database) && !options.disposableConfirmed) {
    return {
      ok: false,
      reason: "The test database name must contain \"test\", or set PACKAM_TEST_DATABASE_IS_DISPOSABLE=1 for a dedicated disposable database.",
    };
  }
  return { ok: true };
}
