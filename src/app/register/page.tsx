import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { resolvePostLoginDestination } from "../../lib/auth-redirect";
import { emailLinksAvailable } from "../../components/account/email-links";
import { RegisterForm } from "../../components/auth/RegisterForm";

export const metadata: Metadata = { title: "Create your account" };

type RegisterPageProps = { searchParams: Promise<{ callbackUrl?: string | string[] }> };

/**
 * Sign-up. Someone already signed in is sent on, as /login does, instead of making a second account. The
 * callbackUrl travels with the form to wherever the new account lands, checked against its role as always. The form
 * only promises a confirmation link when one can be sent (the same check /api/register makes before making one).
 */
export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  const callbackUrl = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl;
  if (session?.user?.role) {
    redirect(resolvePostLoginDestination(session.user.role, callbackUrl));
  }

  return <RegisterForm callbackUrl={callbackUrl} emailConfirmation={emailLinksAvailable()} />;
}
