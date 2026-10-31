import { isValidEmail, normaliseEmail } from "../account/validation";

/**
 * Which way account email goes out, decided from environment variables on every send. Pure and unit-tested.
 * Messages name variables, never their values, so they are safe to log.
 *
 * - PACKAM_DB_TEST=1: an in-memory outbox for database tests. It wins over everything else, so a test run never
 *   sends real mail even when .env holds a provider key. Refused in production.
 * - EMAIL_TRANSPORT=file with EMAIL_FILE_DIR: one JSON file per message, for trying flows locally. Refused in
 *   production.
 * - RESEND_API_KEY with EMAIL_FROM (EMAIL_TRANSPORT unset or "resend"): Resend's HTTP API.
 * - None of these: not configured, so nothing is sent and senders answer "not-configured".
 * Anything half set up throws EmailConfigError saying what to add or remove.
 */

export type EmailConfig =
  | { mode: "resend"; apiKey: string; from: string }
  | { mode: "file"; dir: string }
  | { mode: "memory" }
  | { mode: "none" };

/** The email settings are incomplete or contradictory. Operational, not a problem with any one message. */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export function parseEmailConfig(env: Record<string, string | undefined>): EmailConfig {
  const production = env.NODE_ENV === "production";
  if (env.PACKAM_DB_TEST === "1") {
    if (production) throw new EmailConfigError("PACKAM_DB_TEST is for database tests and can’t be set in production.");
    return { mode: "memory" };
  }

  const transport = env.EMAIL_TRANSPORT?.trim().toLowerCase() ?? "";
  if (transport === "file") {
    if (production) throw new EmailConfigError("EMAIL_TRANSPORT=file is for local testing only. Use RESEND_API_KEY and EMAIL_FROM in production.");
    const dir = env.EMAIL_FILE_DIR?.trim();
    if (!dir) throw new EmailConfigError("EMAIL_TRANSPORT=file needs EMAIL_FILE_DIR, the folder to write messages to.");
    return { mode: "file", dir };
  }
  if (transport && transport !== "resend") throw new EmailConfigError("EMAIL_TRANSPORT must be \"resend\" or \"file\", or left unset.");

  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  const from = env.EMAIL_FROM?.trim() ?? "";
  if (!apiKey && !from) {
    if (transport === "resend") throw new EmailConfigError("EMAIL_TRANSPORT=resend needs RESEND_API_KEY and EMAIL_FROM.");
    if (env.EMAIL_FILE_DIR?.trim()) throw new EmailConfigError("EMAIL_FILE_DIR is set, but EMAIL_TRANSPORT isn’t \"file\".");
    return { mode: "none" };
  }
  if (!apiKey) throw new EmailConfigError("EMAIL_FROM is set, but RESEND_API_KEY is missing.");
  if (!from) throw new EmailConfigError("RESEND_API_KEY is set, but EMAIL_FROM is missing.");
  if (/[\s"']/.test(apiKey)) throw new EmailConfigError("RESEND_API_KEY must be the key alone, without spaces or quotes.");
  if (!senderAddress(from)) throw new EmailConfigError("EMAIL_FROM must be an address on your verified domain, like PackAM <no-reply@your-domain.example>.");
  return { mode: "resend", apiKey, from };
}

/** The address in "Name <address>" or a bare "address", when it is a valid email; otherwise null. */
function senderAddress(from: string) {
  const match = /^(?:[^<>]*<([^<>\s]+)>|([^<>\s]+))$/.exec(from);
  const address = match?.[1] ?? match?.[2] ?? "";
  return isValidEmail(normaliseEmail(address)) ? address : null;
}
