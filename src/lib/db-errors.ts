/**
 * Recognising database errors that mean "this deployment's code is ahead of its database schema",
 * so a page can explain the pending migration instead of crashing. Pure (no Prisma import) so it is
 * unit-tested with the exact error shapes Prisma and the pg driver adapter produce.
 */

type ErrorLike = { code?: unknown; meta?: unknown; message?: unknown };

/**
 * True when Prisma reports that `table` does not exist: P2021 from the query engine, or Postgres
 * 42P01 surfaced through the driver adapter. Any other error (including other missing tables) is false,
 * so genuine failures still reach the error boundary and the server log.
 */
export function isMissingTableError(error: unknown, table: string) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ErrorLike;
  const details = `${typeof candidate.message === "string" ? candidate.message : ""} ${safeStringify(candidate.meta)}`;
  const mentionsTable = details.includes(`"${table}"`) || details.includes(`public.${table}`) || details.includes(`"public.${table}"`) || details.includes(`\\"public.${table}\\"`);
  if (!mentionsTable) return false;
  return candidate.code === "P2021" || details.includes("42P01") || details.includes("TableDoesNotExist");
}

function safeStringify(value: unknown) {
  try { return JSON.stringify(value) ?? ""; } catch { return ""; }
}

/** The migration that creates the payment review table; named in admin messages and logs. */
export const PAYMENT_REVIEW_MIGRATION = "20261020150000_payment_review_cases";
export const PAYMENT_REVIEW_TABLE = "PaymentReviewCase";

export function isPaymentReviewTableMissing(error: unknown) {
  return isMissingTableError(error, PAYMENT_REVIEW_TABLE);
}

/**
 * True when any query failed because the database is missing a table or column the code uses: the
 * deployment's code is ahead of its database (a migration hasn't been applied). P2021/P2022 from Prisma,
 * or Postgres 42P01/42703 and the driver adapter's TableDoesNotExist/ColumnNotFound.
 */
export function isSchemaBehindCode(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ErrorLike;
  if (candidate.code === "P2021" || candidate.code === "P2022") return true;
  const details = `${typeof candidate.message === "string" ? candidate.message : ""} ${safeStringify(candidate.meta)}`;
  return /\b(42P01|42703)\b|TableDoesNotExist|ColumnNotFound/.test(details);
}

/** The missing table or column named in such an error, for the server log only (never the browser). */
export function missingSchemaElement(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  const candidate = error as ErrorLike;
  const details = `${typeof candidate.message === "string" ? candidate.message : ""} ${safeStringify(candidate.meta)}`;
  return details.match(/(?:column|table) `([^`]+)`/)?.[1] ?? details.match(/"column":"([^"]+)"|"table":"([^"]+)"/)?.slice(1).find(Boolean) ?? "unknown";
}

/**
 * The response for a request that hit a schema mismatch: logged loudly with the missing element and the
 * fix, answered with a safe 503 the browser can show ("try again shortly"). Nothing about the database
 * reaches the browser, and nothing is changed or discarded.
 */
export function schemaBehindCodeResponse(error: unknown, where: string) {
  console.error(`SCHEMA BEHIND CODE in ${where}: the database is missing ${missingSchemaElement(error)}. Apply the pending Prisma migrations (npx prisma migrate deploy) to this database.`);
  return Response.json(
    { error: "PackAM is being updated. Your cart is safe — please try again in a few minutes.", code: "SERVICE_UPDATING" },
    { status: 503, headers: { "Retry-After": "120" } },
  );
}
