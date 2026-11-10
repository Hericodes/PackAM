import { createHmac, timingSafeEqual } from "node:crypto";
import { EMAIL_SCOPES, type EmailScope } from "./campaign-rules";

/**
 * Signed unsubscribe links for automated email. A link names one student and one kind of email; it never expires
 * (an old email's link must keep working) and needs no sign-in. The signature is an HMAC keyed from AUTH_SECRET with
 * a purpose label, so a token can't be forged, can't be changed to another student or kind, and is useless anywhere
 * else in PackAM. Pure (the secret is passed in), so it is unit-tested.
 */

export { EMAIL_SCOPES, type EmailScope };

/** The secret must be long enough to sign with; automated email refuses to send without it. */
export const UNSUBSCRIBE_SECRET_MIN_LENGTH = 16;

export function unsubscribeSecretConfigured(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.trim().length >= UNSUBSCRIBE_SECRET_MIN_LENGTH;
}

const toBase64Url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

function signature(secret: string, userId: string, scope: EmailScope) {
  return createHmac("sha256", secret.trim()).update(`packam-email-unsubscribe:v1:${userId}:${scope}`).digest().subarray(0, 24);
}

export function signUnsubscribeToken(secret: string, userId: string, scope: EmailScope) {
  if (!unsubscribeSecretConfigured(secret)) throw new Error("An unsubscribe secret of at least 16 characters is required.");
  return `${toBase64Url(`${userId}:${scope}`)}.${toBase64Url(signature(secret, userId, scope))}`;
}

/** The student and kind a token was made for, or null when it is malformed, tampered with or signed with another key. */
export function verifyUnsubscribeToken(secret: string | undefined, token: unknown): { userId: string; scope: EmailScope } | null {
  if (!unsubscribeSecretConfigured(secret) || typeof token !== "string" || token.length > 300) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(":");
  const userId = decoded.slice(0, separator);
  const scope = decoded.slice(separator + 1) as EmailScope;
  if (separator <= 0 || !/^[a-z0-9]{10,40}$/i.test(userId) || !EMAIL_SCOPES.includes(scope)) return null;
  // Compare the encoded text, not decoded bytes: base64 decoding ignores trailing characters, and a token must match exactly.
  const supplied = Buffer.from(sig, "utf8");
  const expected = Buffer.from(toBase64Url(signature(secret, userId, scope)), "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return { userId, scope };
}
