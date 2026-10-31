import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, authLinkClass } from "../../components/auth/AuthShell";
import { ForgotPasswordForm } from "../../components/auth/ForgotPasswordForm";
import { isEmailConfigured } from "../../lib/email";

export const metadata: Metadata = { title: "Forgot password" };

type ForgotPasswordPageProps = { searchParams: Promise<{ callbackUrl?: string | string[] }> };

/**
 * Step one of a password reset: ask for the account's email. Open to everyone, signed in or not (someone signed in
 * on one phone may have forgotten the password they need on another). The login page's link carries callbackUrl,
 * which is passed back on the way to /login; /login checks it against the person's role as always.
 */
export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  const callbackUrl = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl;
  const loginHref = callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login";
  // When no email can be sent, the form explains that instead, so the subtitle mustn't promise a link.
  const emailAvailable = isEmailConfigured();

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Forgot your password?"
      subtitle={emailAvailable ? "Enter the email address on your PackAM account and we’ll send you a link to choose a new one." : undefined}
      footer={<>Remembered it? <Link href={loginHref} className={authLinkClass}>Back to log in</Link></>}
    >
      <ForgotPasswordForm emailAvailable={emailAvailable} />
    </AuthShell>
  );
}
