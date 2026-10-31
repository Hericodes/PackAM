import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, authLinkClass } from "../../components/auth/AuthShell";
import { FormAlert, type FormAlertTone } from "../../components/auth/FormAlert";
import { ResetPasswordForm } from "../../components/auth/ResetPasswordForm";
import { db } from "../../lib/db";
import { isSchemaBehindCode, missingSchemaElement } from "../../lib/db-errors";
import { peekAccountToken } from "../../lib/account/account-tokens";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The address carries a one-time token: never pass it to another site, and keep the page out of search results.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type ResetPasswordPageProps = { searchParams: Promise<{ token?: string | string[] }> };

type Problem = "missing" | "invalid" | "expired" | "used" | "unavailable";
type LinkState = { kind: "valid"; token: string; email: string; names: string[] } | { kind: Problem };

const PROBLEMS: Record<Problem, { title: string; tone: FormAlertTone; message: string; loginFirst?: boolean }> = {
  missing: {
    title: "Open the link from your email",
    tone: "info",
    message: "To choose a new password, open the reset link we emailed you. If you’ve just refreshed this page, open the link again: we take it out of the address bar to keep it private.",
  },
  invalid: {
    title: "This link isn’t valid",
    tone: "error",
    message: "It may be incomplete or out of date. Make sure you opened the whole link from the email, or request a new one.",
  },
  expired: {
    title: "This link has expired",
    tone: "error",
    message: "Reset links work for 30 minutes. Request a new one and use it straight away.",
  },
  used: {
    title: "This link has already been used",
    tone: "error",
    message: "Each reset link works once, and only the newest one works. If you’ve just chosen a new password, log in with it. If not, request a new link.",
    loginFirst: true,
  },
  unavailable: {
    title: "We couldn’t check this link",
    tone: "error",
    message: "Something went wrong on our side, and your link hasn’t been used. Refresh this page, or open the link from your email again in a few minutes.",
  },
};

/**
 * Where a reset email's link lands: /reset-password?token=…. Works signed out. The token is checked here without
 * being used up (mail scanners that open the link don't spend it); the form sends it back when the new password is
 * saved. A link that can't be used gets a plain explanation and a way to ask for a new one.
 */
export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const link = await checkLink(Array.isArray(params.token) ? params.token[0] : params.token);

  if (link.kind === "valid") {
    return (
      <AuthShell
        eyebrow="Account recovery"
        title="Choose a new password"
        subtitle={<>For <span className="break-all font-bold text-black">{link.email}</span>. Saving it signs you out on every device, so you’ll log in again with the new password.</>}
        footer={<>Remembered your password? <Link href="/login" className={authLinkClass}>Log in</Link></>}
      >
        <ResetPasswordForm token={link.token} email={link.email} names={link.names} />
      </AuthShell>
    );
  }

  const problem = PROBLEMS[link.kind];
  const request = { href: "/forgot-password", label: "Request a new link" };
  const login = { href: "/login", label: "Log in" };
  const actions = problem.loginFirst ? [login, request] : [request, login];
  return (
    <AuthShell eyebrow="Account recovery" title={problem.title}>
      <FormAlert tone={problem.tone}>{problem.message}</FormAlert>
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

/** The same checks the reset makes when it's saved: an unspent link for an ACTIVE account with a password, still at the address it was sent to. */
async function checkLink(token: string | undefined): Promise<LinkState> {
  if (!token) return { kind: "missing" };
  try {
    const link = await peekAccountToken(db, { token, purpose: "PASSWORD_RESET" });
    if (!link.ok) return { kind: link.reason };
    const account = await db.user.findUnique({
      where: { id: link.userId },
      select: { email: true, firstName: true, lastName: true, status: true, passwordHash: true },
    });
    if (!account || account.status !== "ACTIVE" || !account.passwordHash || account.email !== link.email) return { kind: "invalid" };
    return { kind: "valid", token, email: account.email, names: [account.firstName, account.lastName].filter((name): name is string => Boolean(name)) };
  } catch (error) {
    if (isSchemaBehindCode(error)) {
      console.error(`SCHEMA BEHIND CODE in password reset page: the database is missing ${missingSchemaElement(error)}. Apply the pending Prisma migrations (npx prisma migrate deploy) to this database.`);
    } else {
      console.error("RESET PASSWORD PAGE ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
    return { kind: "unavailable" };
  }
}
