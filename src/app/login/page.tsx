import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { resolvePostLoginDestination } from "../../lib/auth-redirect";
import { LoginForm, type LoginNotice } from "../../components/auth/LoginForm";

export const metadata: Metadata = { title: "Log in" };

type Param = string | string[] | undefined;
type LoginPageProps = {
  searchParams: Promise<{ callbackUrl?: Param; registered?: Param; reset?: Param; verified?: Param; emailChanged?: Param; signedOut?: Param }>;
};

const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  const callbackUrl = first(params.callbackUrl);
  if (session?.user?.role) {
    redirect(resolvePostLoginDestination(session.user.role, callbackUrl));
  }

  return <LoginForm callbackUrl={callbackUrl} notice={noticeFor(params)} />;
}

/** What brought the person here, for the banner above the form; one at a time, the most important first. */
function noticeFor(params: Awaited<LoginPageProps["searchParams"]>): LoginNotice | undefined {
  if (first(params.reset) === "done") return "reset";
  if (first(params.emailChanged) === "1") return "emailChanged";
  if (first(params.verified) === "1") return "verified";
  if (first(params.registered) === "true") return "registered";
  if (first(params.signedOut) === "1") return "signedOut";
  return undefined;
}
