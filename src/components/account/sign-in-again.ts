import { signIn } from "next-auth/react";

/**
 * Where this browser goes when it can't sign itself back in: every session was just ended, so it is signed out.
 * Back to Settings after logging in (resolvePostLoginDestination allows /settings for every role).
 */
export const LOG_IN_AGAIN = "/login?signedOut=1&callbackUrl=%2Fsettings";

/**
 * Signs this browser straight back in after the account's sessions were ended on the server (a password change,
 * or "sign out of other devices"), with the password the person has just typed, so other devices stay signed
 * out and this one doesn't. Nothing is stored. True when it worked.
 *
 * redirectTo is a clean /settings: next-auth/react reads `error` and `code` from the URL the server answers with,
 * which is this one on success.
 */
export async function signInAgain(email: string, password: string): Promise<boolean> {
  try {
    const result = await signIn("credentials", { identifier: email, password, redirect: false, redirectTo: "/settings" });
    return Boolean(result) && !result.error;
  } catch {
    return false;
  }
}
