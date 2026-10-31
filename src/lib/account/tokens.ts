import { createHash, randomBytes } from "node:crypto";

/**
 * One-time tokens for email links (verification, password reset, email change). The raw token only ever
 * exists in the emailed link; the database keeps its SHA-256 hash, so a database leak can't be replayed.
 * 32 random bytes = 256 bits, so lookups by hash need no constant-time comparison.
 */

export const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before touching the database, so junk never reaches a query. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
