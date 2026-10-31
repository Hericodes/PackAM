/**
 * Account details as people type them (sign-up, settings, recovery). Pure, so the browser shows the same checks
 * the server enforces, and they are unit-tested. Stored values must keep matching: every email is stored trimmed
 * and lowercased, every phone only trimmed, so login and lookups normalise the same way.
 */

export const EMAIL_MAX = 254;
export const NAME_MAX = 60;
export const PHONE_MIN = 7;
export const PHONE_MAX = 20;

/** Trimmed and lowercased, as every stored email is. "" for anything that isn't a string. */
export function normaliseEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const EMAIL_LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/i;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * A sane address: one @, a dotted domain ending in a real-looking top-level name, no spaces, at most 254
 * characters. Not proof the inbox exists (only a confirmation link proves that). Check after normaliseEmail().
 */
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string" || value.length > EMAIL_MAX) return false;
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, at);
  if (!EMAIL_LOCAL.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = value.slice(at + 1).split(".");
  const topLevel = labels[labels.length - 1];
  return labels.length >= 2 && labels.every((label) => DOMAIN_LABEL.test(label)) && topLevel.length >= 2 && /^[a-z]/i.test(topLevel);
}

/** Trimmed, with runs of spaces collapsed to one. "" for anything that isn't a string. */
export function normaliseName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** Letters in any alphabet (accents included), spaces, apostrophes (straight or curly), hyphens and dots. */
const NAME_PATTERN = /^[\p{L}\p{M} '’.-]+$/u;

/**
 * Why a first or last name can't be used, or null when it can. Normalises first, so raw input is fine.
 * `label` names the field in the sentence, e.g. nameProblem(value, "first name") → "Enter your first name."
 */
export function nameProblem(value: unknown, label = "name"): string | null {
  const name = normaliseName(value);
  if (!name) return `Enter your ${label}.`;
  if (Array.from(name).length > NAME_MAX) return `Keep your ${label} to ${NAME_MAX} characters or fewer.`;
  if (!NAME_PATTERN.test(name)) return `Use only letters, spaces, apostrophes, hyphens and dots in your ${label}.`;
  if (!/\p{L}/u.test(name)) return `Your ${label} needs at least one letter.`;
  return null;
}

/** Trimmed only. Phones have always been stored as typed (trimmed), so existing ones must keep matching. */
export function normalisePhone(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const PHONE_PATTERN = /^\+?[0-9 ()-]+$/;

/**
 * Why a phone number can't be used, or null when it can: 7–20 characters of digits, spaces, hyphens and
 * brackets, optionally starting with +, and at least 7 digits. Normalises first, so raw input is fine.
 */
export function phoneProblem(value: unknown): string | null {
  const phone = normalisePhone(value);
  if (!phone) return "Enter your phone number.";
  const digits = phone.replace(/\D/g, "").length;
  if (phone.length < PHONE_MIN || phone.length > PHONE_MAX || !PHONE_PATTERN.test(phone) || digits < PHONE_MIN) {
    return "Enter a valid phone number, like 08012345678.";
  }
  return null;
}

/**
 * "ada@uni.edu" → "a••@uni.edu": recognisable to its owner without showing the whole address. Always two dots,
 * so the length of the name part isn't revealed either.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const local = at === -1 ? email : email.slice(0, at);
  const domain = at === -1 ? "" : email.slice(at);
  const first = Array.from(local)[0] ?? "";
  return `${first}••${domain}`;
}
