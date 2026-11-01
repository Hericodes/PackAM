import { signIn } from "next-auth/react";
import { canSignIn } from "../auth/sign-in-reachable";

/**
 * Where this browser goes when it can't sign itself back in: every session was just ended, so it is signed out.
 * Back to Settings after logging in (resolvePostLoginDestination allows /settings for every role).
 */
export const LOG_IN_AGAIN = "/login?signedOut=1&callbackUrl=%2Fsettings";
/** The same after a password change: /login's ?reset=done banner says the password changed and every device was signed out. */
export const LOG_IN_WITH_NEW_PASSWORD = "/login?reset=done&callbackUrl=%2Fsettings";

/**
 * Signs this browser straight back in after the account's sessions were ended on the server (a password change,
 * or "sign out of other devices"), with the password the person has just typed, so other devices stay signed
 * out and this one doesn't. Nothing is stored. True when it worked. Pass the email from reauthEmail().
 *
 * redirectTo is a clean /settings: next-auth/react reads `error` and `code` from the URL the server answers with,
 * which is this one on success. When PackAM can't be reached it doesn't try (signIn() would leave for
 * /api/auth/error), so the caller's own "log in again" page is where the browser goes.
 */
export async function signInAgain(email: string, password: string): Promise<boolean> {
  if (!(await canSignIn())) return false;
  try {
    const result = await signIn("credentials", { identifier: email, password, redirect: false, redirectTo: "/settings" });
    return Boolean(result) && !result.error;
  } catch {
    return false;
  }
}

/**
 * The email to sign back in with: the one the route that ended the sessions answered with (the account's email as it
 * is now; it may have changed since this page was rendered, say by a new email confirmed in another tab), otherwise
 * the one the page shows.
 */
export function reauthEmail(answer: unknown, shownEmail: string): string {
  const email = answer !== null && typeof answer === "object" ? (answer as { email?: unknown }).email : undefined;
  return typeof email === "string" && email.trim() ? email.trim() : shownEmail;
}
