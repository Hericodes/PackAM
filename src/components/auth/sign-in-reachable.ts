import { getProviders } from "next-auth/react";

type Reachability = {
  /** False when the browser knows it is offline (navigator.onLine). */
  online: () => boolean;
  /** next-auth/react's own provider list request: null when it couldn't be fetched. */
  providers: () => Promise<unknown>;
};

const BROWSER: Reachability = { online: () => navigator.onLine, providers: getProviders };

/**
 * Whether next-auth/react's signIn("credentials", …) can run without leaving the page. signIn() starts by fetching
 * the provider list and, when that fails (offline, or PackAM out of reach), sends the browser to /api/auth/error
 * itself, even with redirect: false (or to its own sign-in page when the credentials provider is missing). So the
 * forms ask first and show their own message instead. Never throws; `check` is for tests.
 */
export async function canSignIn(check: Reachability = BROWSER): Promise<boolean> {
  if (!check.online()) return false;
  try {
    const providers = await check.providers();
    return providers !== null && typeof providers === "object" && "credentials" in providers;
  } catch {
    return false;
  }
}
