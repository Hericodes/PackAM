import type { FormAlertTone } from "./FormAlert";

/**
 * The words and next steps on /verify-email, where an email confirmation link lands. No React and no "server-only",
 * so the page, its form and the tests share them. An outcome is what pressing "Confirm my email" answered (POST
 * /api/account/verify-email), why the link can't be used (found when the page opened), "error" when it couldn't be
 * checked or confirmed just then, or "waiting" when there is no link (typed in, or refreshed after the token left the
 * address bar).
 */

export const VERIFY_STATUSES = ["verified", "already", "expired", "used", "invalid"] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];
export type VerifyEmailOutcome = VerifyStatus | "error" | "waiting";

/** Who is looking: signed in (to any account) or not, and where their role's home is. */
export type VerifyEmailViewer = { signedIn: boolean; home: string };

type Copy = { tone: FormAlertTone; title: string; message: string };

/** What happens next: "done" (nothing to do), "resend" (send a new link from Settings) or "retry" (open the same link again). */
type Next = "done" | "resend" | "retry";

const COPY: Record<VerifyEmailOutcome, Copy & { next: Next }> = {
  verified: {
    tone: "success",
    title: "Email confirmed",
    message: "Thanks! Your email address is confirmed, so PackAM can reach you about your account, for example to help you reset your password.",
    next: "done",
  },
  already: { tone: "success", title: "Already confirmed", message: "Your email address is already confirmed. There’s nothing else to do.", next: "done" },
  expired: { tone: "error", title: "This link has expired", message: "Confirmation links work for 24 hours. You can send yourself a new one from Settings.", next: "resend" },
  used: {
    tone: "error",
    title: "This link has already been used",
    message: "Each confirmation link works once, and only the newest one you were sent works. If your email still shows as not confirmed, send a new link from Settings.",
    next: "resend",
  },
  invalid: {
    tone: "error",
    title: "This link isn’t valid",
    message: "It may be incomplete, or it was sent to an email address that’s no longer on your account. You can send a new link from Settings.",
    next: "resend",
  },
  error: {
    tone: "error",
    title: "We couldn’t confirm your email",
    message: "Something went wrong on our side, and your link hasn’t been used. Open it again from your email in a few minutes.",
    next: "retry",
  },
  waiting: {
    tone: "info",
    title: "Confirm your email",
    message: "Open the link in the email we sent you to confirm your address. If you’ve just refreshed this page, open the link again: we take it out of the address bar to keep it private.",
    next: "resend",
  },
};

export function isVerifyStatus(value: unknown): value is VerifyStatus {
  return typeof value === "string" && (VERIFY_STATUSES as readonly string[]).includes(value);
}

/** The { status } POST /api/account/verify-email answers, or "error" for anything else (a guard's refusal, an error page). */
export function verifyEmailAnswer(data: unknown): VerifyStatus | "error" {
  const status = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as { status?: unknown }).status : undefined;
  return isVerifyStatus(status) ? status : "error";
}

/** A ?status= in the page's address (older links redirected with one): the outcome it names, or "waiting". */
export function verifyEmailOutcome(status: string | undefined): VerifyEmailOutcome {
  return isVerifyStatus(status) || status === "error" ? status : "waiting";
}

export function verifyEmailCopy(outcome: VerifyEmailOutcome): Copy {
  const { tone, title, message } = COPY[outcome];
  return { tone, title, message };
}

/** The buttons under the message, most useful first. Settings (every role has it) is where a new link is sent. */
export function verifyEmailLinks(outcome: VerifyEmailOutcome, viewer: VerifyEmailViewer): Array<{ href: string; label: string }> {
  const next = COPY[outcome].next;
  if (viewer.signedIn) {
    const home = { href: viewer.home, label: "Continue to PackAM" };
    if (next === "done") return [home, { href: "/settings", label: "Go to Settings" }];
    if (next === "resend") return [{ href: "/settings", label: "Send a new link from Settings" }, home];
    return [home];
  }
  if (next === "done") return [{ href: "/login?verified=1", label: "Log in" }];
  if (next === "resend") return [{ href: `/login?callbackUrl=${encodeURIComponent("/settings")}`, label: "Log in to send a new link" }, { href: "/", label: "Back to PackAM" }];
  return [{ href: "/", label: "Back to PackAM" }];
}
