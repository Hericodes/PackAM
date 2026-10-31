/**
 * Why a sign-in failed, as a code src/auth.ts puts on its CredentialsSignin errors, and what the login form says
 * for each. Codes travel in the URL Auth.js builds (?error=CredentialsSignin&code=…), so none may reveal whether
 * an account exists: "inactive" is only sent after the password matched, and "rate_limited" counts attempts per
 * address and identifier whether or not there is an account. Pure, so auth, the form and the tests share it.
 */

export const LOGIN_ERROR_CODES = {
  credentials: "credentials",
  rate_limited: "rate_limited",
  inactive: "inactive",
} as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[keyof typeof LOGIN_ERROR_CODES];

/**
 * The message for a failed next-auth/react signIn() result: pass its `code` and `error`. Anything other than a
 * credentials failure (Auth.js "Configuration" when the server failed, or no answer at all) is shown as a
 * connection problem, because retrying is the useful thing to do.
 */
export function loginErrorMessage(code: string | undefined, error: string | undefined): string {
  if (error !== "CredentialsSignin") return "We couldn’t reach PackAM. Check your connection and try again.";
  if (code === LOGIN_ERROR_CODES.rate_limited) return "Too many sign-in attempts. Wait a few minutes, then try again.";
  if (code === LOGIN_ERROR_CODES.inactive) return "This account is paused or closed, so it can’t sign in. Contact PackAM support if you think that’s a mistake.";
  return "That email, phone number or password isn’t right. Check them and try again.";
}
