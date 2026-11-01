import "server-only";

import { db } from "../db";
import { isSchemaBehindCode, missingSchemaElement } from "../db-errors";
import { purgeExpiredAccountTokens } from "./account-tokens";
import { sweepDeletedAccountDocuments } from "./deletion";

/** Per run, so the scheduled call stays short; anything left over is picked up by the next run. */
const DOCUMENTS_PER_RUN = 25;
const EXPIRED_LINKS_PER_RUN = 500;

/**
 * Account clean-up for the scheduled run: retries removing deleted accounts' print files from storage, and deletes
 * emailed-link rows that expired long ago. The two steps are independent and this never throws: a failure is logged
 * by error name and the next run tries again. A database without the account-security migration has no link table
 * yet, so that step is skipped. `deleteFile` is replaceable for tests.
 */
export async function runAccountHousekeeping(input: { now?: Date; deleteFile?: (publicId: string) => Promise<void> } = {}) {
  let documents: { removed: number; failed: number } | null = null;
  let expiredLinks: number | null = null;
  try {
    documents = await sweepDeletedAccountDocuments(DOCUMENTS_PER_RUN, input.deleteFile);
  } catch (error) {
    console.error("ACCOUNT HOUSEKEEPING ERROR (documents):", error instanceof Error ? error.name : "Unknown error");
  }
  try {
    expiredLinks = await purgeExpiredAccountTokens(db, { now: input.now, take: EXPIRED_LINKS_PER_RUN });
  } catch (error) {
    if (isSchemaBehindCode(error)) console.warn(`ACCOUNT HOUSEKEEPING: expired-link clean-up skipped; the database is missing ${missingSchemaElement(error)}.`);
    else console.error("ACCOUNT HOUSEKEEPING ERROR (links):", error instanceof Error ? error.name : "Unknown error");
  }
  if (documents?.removed || documents?.failed || expiredLinks) {
    console.info(JSON.stringify({ event: "account_housekeeping", documents, expiredLinks }));
  }
  return { documents, expiredLinks };
}
