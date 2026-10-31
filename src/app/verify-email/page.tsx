import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "../../auth";
import { AuthShell } from "../../components/auth/AuthShell";
import { FormAlert, type FormAlertTone } from "../../components/auth/FormAlert";
import { roleHome } from "../../lib/auth-redirect";

type VerifyEmailPageProps = { searchParams: Promise<{ status?: string | string[] }> };

/** What happens next: "done" (nothing to do), "resend" (send a new link from Settings) or "retry" (open the same link again). */
type Next = "done" | "resend" | "retry";
type Outcome = { title: string; tone: FormAlertTone; message: string; next: Next };

/** The statuses /api/account/verify-email redirects with. */
const OUTCOMES = {
  verified: {
    title: "Email confirmed",
    tone: "success",
    message: "Thanks! Your email address is confirmed, so PackAM can reach you about your account, for example to help you reset your password.",
    next: "done",
  },
  already: {
    title: "Already confirmed",
    tone: "success",
    message: "Your email address is already confirmed. There’s nothing else to do.",
    next: "done",
  },
  expired: {
    title: "This link has expired",
    tone: "error",
    message: "Confirmation links work for 24 hours. You can send yourself a new one from Settings.",
    next: "resend",
  },
  used: {
    title: "This link has already been used",
    tone: "error",
    message: "Each confirmation link works once, and only the newest one you were sent works. If your email still shows as not confirmed, send a new link from Settings.",
    next: "resend",
  },
  invalid: {
    title: "This link isn’t valid",
    tone: "error",
    message: "It may be incomplete, or it was sent to an email address that’s no longer on your account. You can send a new link from Settings.",
    next: "resend",
  },
  error: {
    title: "We couldn’t confirm your email",
    tone: "error",
    message: "Something went wrong on our side, and your link hasn’t been used. Open it again from your email in a few minutes.",
    next: "retry",
  },
} satisfies Record<string, Outcome>;

/** Someone who came here without a result, e.g. by typing the address. */
const WAITING: Outcome = {
  title: "Confirm your email",
  tone: "info",
  message: "Open the link in the email we sent you to confirm your address. Can’t find it? You can send a new one from Settings.",
  next: "resend",
};

function isOutcome(status: string | undefined): status is keyof typeof OUTCOMES {
  return status !== undefined && Object.prototype.hasOwnProperty.call(OUTCOMES, status);
}

async function outcomeFor(searchParams: VerifyEmailPageProps["searchParams"]): Promise<Outcome> {
  const params = await searchParams;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;
  return isOutcome(status) ? OUTCOMES[status] : WAITING;
}

/** The tab title says how it went, so it's the first thing a screen reader announces. */
export async function generateMetadata({ searchParams }: VerifyEmailPageProps): Promise<Metadata> {
  return {
    title: (await outcomeFor(searchParams)).title,
    // Reached from a link in an email; nothing here should travel on to another site or into search results.
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

/**
 * Where an email confirmation link ends up, once /api/account/verify-email has used it: /verify-email?status=…
 * (verified, already, expired, used, invalid or error). The token never reaches this page. It works signed out;
 * signed in, it offers the way back into PackAM and to Settings, where a new link can be sent.
 */
export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const [session, outcome] = await Promise.all([auth(), outcomeFor(searchParams)]);
  const actions = nextSteps(outcome.next, session?.user?.role);

  return (
    <AuthShell eyebrow="Email confirmation" title={outcome.title}>
      <FormAlert tone={outcome.tone}>{outcome.message}</FormAlert>
      <div className="mt-5 grid gap-3">
        {actions.map((action, index) => (
          <Link key={action.href} href={action.href} className={`pk-btn pk-btn-lg w-full text-base ${index === 0 ? "pk-btn-primary" : "pk-btn-secondary"}`}>
            {action.label}
          </Link>
        ))}
      </div>
    </AuthShell>
  );
}

/** The buttons under the message, most useful first. Settings (every role has it) is where a new link is sent. */
function nextSteps(next: Next, role: string | undefined) {
  if (role) {
    const home = { href: roleHome(role), label: "Continue to PackAM" };
    if (next === "done") return [home, { href: "/settings", label: "Go to Settings" }];
    if (next === "resend") return [{ href: "/settings", label: "Send a new link from Settings" }, home];
    return [home];
  }
  if (next === "done") return [{ href: "/login?verified=1", label: "Log in" }];
  if (next === "resend") return [{ href: `/login?callbackUrl=${encodeURIComponent("/settings")}`, label: "Log in to send a new link" }, { href: "/", label: "Back to PackAM" }];
  return [{ href: "/", label: "Back to PackAM" }];
}
