import type { Metadata } from "next";
import { auth } from "../../auth";
import { VerifyEmailForm } from "../../components/auth/VerifyEmailForm";
import { VerifyEmailResult } from "../../components/auth/VerifyEmailResult";
import { verifyEmailCopy, verifyEmailOutcome, type VerifyEmailOutcome } from "../../components/auth/verify-email";
import { isSchemaBehindCode, missingSchemaElement } from "../../lib/db-errors";
import { checkVerificationLink } from "../../lib/account/email-verification";
import { roleHome } from "../../lib/auth-redirect";

type VerifyEmailPageProps = { searchParams: Promise<{ token?: string | string[]; status?: string | string[] }> };

type LinkState = { kind: "valid"; token: string; maskedEmail: string } | { kind: Exclude<VerifyEmailOutcome, "verified" | "waiting"> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The tab title says where things stand, so it's the first thing a screen reader announces. */
export async function generateMetadata({ searchParams }: VerifyEmailPageProps): Promise<Metadata> {
  const params = await searchParams;
  return {
    title: first(params.token) ? "Confirm your email" : verifyEmailCopy(verifyEmailOutcome(first(params.status))).title,
    // The address can carry a one-time token: never pass it to another site, and keep the page out of search results.
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

/**
 * Where an email confirmation link lands: GET /api/account/verify-email sends it here as /verify-email?token=… without
 * using it. Works signed in or out. The token is checked here without being used up, and the page shows the address
 * masked with a "Confirm my email" button; only pressing it confirms the address (mail scanners and link previews
 * open links, but don't press buttons). A link that can't be used gets a plain explanation and where to go next, as
 * does every answer to the button. Without a token it shows the ?status= older links redirected with, or how to find
 * the link.
 */
export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = first(params.token);
  const [session, link] = await Promise.all([auth(), token ? checkLink(token) : null]);
  const role = session?.user?.role;
  const viewer = { signedIn: Boolean(role), home: role ? roleHome(role) : "/" };

  if (link?.kind === "valid") return <VerifyEmailForm token={link.token} maskedEmail={link.maskedEmail} viewer={viewer} />;
  return <VerifyEmailResult outcome={link ? link.kind : verifyEmailOutcome(first(params.status))} viewer={viewer} />;
}

/** The checks the confirmation repeats when the button is pressed: an unspent, unexpired link for the account's current, unconfirmed email. */
async function checkLink(token: string): Promise<LinkState> {
  try {
    const link = await checkVerificationLink(token);
    return link.kind === "valid" ? { kind: "valid", token, maskedEmail: link.maskedEmail } : link;
  } catch (error) {
    if (isSchemaBehindCode(error)) {
      console.error(`SCHEMA BEHIND CODE in verify email page: the database is missing ${missingSchemaElement(error)}. Apply the pending Prisma migrations (npx prisma migrate deploy) to this database.`);
    } else {
      console.error("VERIFY EMAIL PAGE ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
    return { kind: "error" };
  }
}
