import type { Instrumentation } from "next";
import { isSchemaBehindCode, missingSchemaElement } from "./lib/db-errors";

/**
 * One searchable log line for every server error, keyed by the digest students see as "Reference" on the
 * error page, so a reported reference leads straight to its cause in the Vercel logs.
 *
 * Only safe facts are logged: the route, method, error name/code and digest. Never the query string,
 * headers (cookies, auth), request bodies or the raw error message, which can carry customer data.
 * A database that's behind the deployed code (a migration not applied) is called out with the missing
 * table or column and the fix.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const e = (error && typeof error === "object" ? error : {}) as { name?: unknown; code?: unknown; digest?: unknown };
  const fields = {
    digest: typeof e.digest === "string" ? e.digest : undefined,
    route: context.routePath,
    type: context.routeType,
    method: request.method,
    path: request.path.split("?")[0],
    error: typeof e.name === "string" ? e.name : typeof error,
    code: typeof e.code === "string" ? e.code : undefined,
  };
  if (isSchemaBehindCode(error)) {
    console.error(`SCHEMA BEHIND CODE: the database is missing ${missingSchemaElement(error)}. Apply the pending Prisma migrations to this database.`, JSON.stringify(fields));
    return;
  }
  console.error("SERVER ERROR", JSON.stringify(fields));
};
