/**
 * Rules for choosing a password (sign-up, reset, change). Pure, so the browser shows the same checks the
 * server enforces, and they are unit-tested. Existing passwords are never re-checked: these apply only when
 * a password is set.
 */

export const PASSWORD_MIN = 8;
/** bcrypt only reads the first 72 bytes; anything longer would be silently ignored, so it's refused. */
export const PASSWORD_MAX_BYTES = 72;

/** The most common choices, plus PackAM-specific ones. Compared case-insensitively. */
const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "11111111", "00000000", "abc12345", "abcd1234", "iloveyou", "iloveyou1",
  "letmein1", "welcome1", "welcome123", "admin123", "football1", "monkey123", "dragon123", "sunshine1",
  "princess1", "baseball1", "trustno1", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "q1w2e3r4", "asdf1234",
  "packam123", "packam1234", "packampassword", "student1", "student123", "nigeria1", "nigeria123", "lagos123",
]);

export type PasswordRule = { id: "length" | "mix" | "common" | "personal"; label: string; met: boolean };

export function utf8Length(value: string) {
  return new TextEncoder().encode(value).length;
}

/**
 * The visible checklist. "personal" uses the email's name part and the person's names when known.
 */
export function passwordRules(password: string, personal: { email?: string; names?: string[] } = {}): PasswordRule[] {
  const lower = password.toLowerCase();
  const fragments = [
    ...(personal.email ? [personal.email.split("@")[0]] : []),
    ...(personal.names ?? []),
  ].map((part) => part.trim().toLowerCase()).filter((part) => part.length >= 3);
  return [
    { id: "length", label: `At least ${PASSWORD_MIN} characters`, met: password.length >= PASSWORD_MIN && utf8Length(password) <= PASSWORD_MAX_BYTES },
    { id: "mix", label: "A letter and a number or symbol", met: /\p{L}/u.test(password) && /[\p{N}\p{P}\p{S}]/u.test(password) },
    { id: "common", label: "Not a common password", met: password.length > 0 && !COMMON.has(lower) && !/^(.)\1+$/.test(password) },
    { id: "personal", label: "Doesn’t contain your name or email", met: password.length > 0 && !fragments.some((part) => lower.includes(part)) },
  ];
}

/** The server's verdict: the first unmet rule as a sentence, or null when the password can be used. */
export function passwordProblem(password: unknown, personal: { email?: string; names?: string[] } = {}): string | null {
  if (typeof password !== "string" || !password) return "Enter a password.";
  if (utf8Length(password) > PASSWORD_MAX_BYTES) return `Use a shorter password (up to ${PASSWORD_MAX_BYTES} characters).`;
  if (password.trim() !== password) return "Remove spaces from the start or end of your password.";
  const unmet = passwordRules(password, personal).find((rule) => !rule.met);
  if (!unmet) return null;
  return {
    length: `Use at least ${PASSWORD_MIN} characters.`,
    mix: "Include a letter and a number or symbol.",
    common: "That password is too common. Choose something harder to guess.",
    personal: "Don’t use your name or email in your password.",
  }[unmet.id];
}

/**
 * 0–4 strength for the meter: length and variety, with common or patterned passwords held down. Advisory
 * only; passwordProblem() decides what's allowed.
 */
export function passwordStrength(password: string, personal: { email?: string; names?: string[] } = {}): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: "" };
  const rules = passwordRules(password, personal);
  if (rules.some((rule) => !rule.met && rule.id !== "length")) return { score: 1, label: "Weak" };
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[\p{P}\p{S}\s]/u].filter((pattern) => pattern.test(password)).length;
  const unique = new Set(password).size;
  let points = 0;
  if (password.length >= PASSWORD_MIN) points += 1;
  if (password.length >= 12) points += 1;
  if (password.length >= 16) points += 1;
  if (classes >= 3) points += 1;
  if (unique < 5) points -= 1;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(password)) points -= 1;
  const score = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4;
  return { score, label: ["", "Weak", "Fair", "Good", "Strong"][score] };
}
