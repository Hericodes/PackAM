import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { resolvePostLoginDestination } from "../../lib/auth-redirect";
import { LoginForm } from "../../components/auth/LoginForm";

type LoginPageProps = { searchParams: Promise<{ callbackUrl?: string | string[]; registered?: string }> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  const callbackUrl = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl;
  if (session?.user?.role) {
    redirect(resolvePostLoginDestination(session.user.role, callbackUrl));
  }

  return <Suspense fallback={<main className="min-h-screen bg-[#fffdf7] px-4 py-8 sm:px-6 sm:py-10"><div className="mx-auto flex min-h-[85vh] max-w-md flex-col justify-center"><p className="text-center text-sm font-medium text-black/65">Loading PackAM...</p></div></main>}>
    <LoginForm registered={params.registered === "true"} callbackUrl={callbackUrl} />
  </Suspense>;
}
