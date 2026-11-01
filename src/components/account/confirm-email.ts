import { isEmailChangeStatus, type EmailChangeStatus } from "./account-requests";

/**
 * The words and next steps on /confirm-email, where a "confirm your new email" link lands. No React and no
 * "server-only", so the page, its form and the tests share them. An outcome is either what pressing "Confirm new
 * email" answered (POST /api/account/email/confirm), or why the link can't be used, found when the page opened:
 * "missing" (no token: typed in, or refreshed after the token left the address bar) or "unavailable" (it couldn't be
 * checked just then).
 */

export type ConfirmEmailOutcome = EmailChangeStatus | "missing" | "unavailable";

/**
 * Who is looking: signed in (to any account) or not, and where their role's home is. `otherAccount`: signed in to an
 * account other than the one the link is for, so nothing here may call the link's account "your account".
 */
export type ConfirmEmailViewer = { signedIn: boolean; home: string; otherAccount?: boolean };

type Copy = { tone: "success" | "error" | "info"; title: string; message: string };

/** The { status } POST /api/account/email/confirm answers, or "error" for anything else (a guard's refusal, an error page). */
export function confirmEmailAnswer(data: unknown): EmailChangeStatus | "error" {
  const status = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as { status?: unknown }).status : undefined;
  return isEmailChangeStatus(status) ? status : "error";
}

/**
 * The heading and message for each outcome. `maskedEmail` (maskEmail) names the new address once it's in use;
 * `otherAccount` is true when the viewer is signed in to a different account from the link's.
 */
export function confirmEmailCopy(outcome: ConfirmEmailOutcome, maskedEmail?: string, otherAccount = false): Copy {
  switch (outcome) {
    case "changed":
      if (otherAccount) {
        return {
          tone: "success",
          title: "Email changed",
          message: `The PackAM account this link was for now uses ${maskedEmail || "the new email"}, and it’s verified. That isn’t the account you’re signed in to.`,
        };
      }
      return {
        tone: "success",
        title: "Email changed",
        message: `Your PackAM account now uses ${maskedEmail || "your new email"}, and it’s verified. Use it the next time you log in.`,
      };
    case "expired":
      return { tone: "error", title: "This link has expired", message: "Links to confirm a new email work for 24 hours, so your email hasn’t changed. Start the change again in Settings to get a new link." };
    case "used":
      return {
        tone: "error",
        title: "This link has already been used",
        message: "Each link works once, and asking again replaces the earlier one. If you’ve already confirmed this change, there’s nothing else to do. If not, your email hasn’t changed: start the change again in Settings.",
      };
    case "taken":
      return { tone: "error", title: "That email is already in use", message: "Another PackAM account started using that address before you confirmed it, so your email hasn’t changed." };
    case "invalid":
      return { tone: "error", title: "This link isn’t valid", message: "It may be incomplete or out of date, so your email hasn’t changed. Open the newest link we sent, or start the change again in Settings." };
    case "missing":
      return {
        tone: "info",
        title: "Open the link from your email",
        message: "To confirm your new email, open the link we sent to it. If you’ve just refreshed this page, open the link again: we take it out of the address bar to keep it private.",
      };
    case "unavailable":
      return { tone: "error", title: "We couldn’t check this link", message: "Something went wrong on our side, and your email hasn’t changed. Open the link from your email again in a few minutes." };
  }
}

/**
 * The buttons under the message, most useful first. Signed in: Settings (where a change starts again) and home.
 * Signed out: log in (to Settings, unless the change went through) and the home page.
 */
export function confirmEmailLinks(outcome: ConfirmEmailOutcome, viewer: ConfirmEmailViewer): Array<{ href: string; label: string }> {
  if (viewer.signedIn) return [{ href: "/settings", label: "Go to Settings" }, { href: viewer.home, label: "Continue to PackAM" }];
  if (outcome === "changed") return [{ href: "/login?emailChanged=1", label: "Log in" }];
  return [{ href: "/login?callbackUrl=%2Fsettings", label: "Log in" }, { href: "/", label: "Back to PackAM" }];
}
