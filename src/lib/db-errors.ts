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
