import type { Metadata } from "next";
import { auth } from "../../auth";
import { ConfirmEmailForm } from "../../components/account/ConfirmEmailForm";
import { ConfirmEmailResult } from "../../components/account/ConfirmEmailResult";
import type { ConfirmEmailOutcome } from "../../components/account/confirm-email";
import { db } from "../../lib/db";
import { isSchemaBehindCode, missingSchemaElement } from "../../lib/db-errors";
import { peekAccountToken } from "../../lib/account/account-tokens";
import { maskEmail } from "../../lib/account/validation";
import { roleHome } from "../../lib/auth-redirect";

export const metadata: Metadata = {
  title: "Confirm your new email",
  // The address carries a one-time token: never pass it to another site, and keep the page out of search results.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type ConfirmEmailPageProps = { searchParams: Promise<{ token?: string | string[] }> };

type LinkState = { kind: "valid"; token: string; maskedEmail: string; userId: string } | { kind: Exclude<ConfirmEmailOutcome, "changed" | "taken"> };

/**
 * Where a "confirm your new email" link lands: GET /api/account/email/confirm sends it here as /confirm-email?token=…
 * without changing anything. Works signed in or out. The token is checked here without being used up, and the page
 * shows the new address masked with a "Confirm new email" button; only pressing it changes the email (mail scanners
 * and link previews open links, but don't press buttons). A link that can't be used gets a plain explanation and
 * where to go next, as does every answer to the button.
 */
export default async function ConfirmEmailPage({ searchParams }: ConfirmEmailPageProps) {
  const params = await searchParams;
  const [session, link] = await Promise.all([auth(), checkLink(Array.isArray(params.token) ? params.token[0] : params.token)]);
  const role = session?.user?.role;
  const viewer = { signedIn: Boolean(role), home: role ? roleHome(role) : "/" };

  if (link.kind === "valid") {
    // Signed in to someone else's account: the page must not call the link's account "yours".
    const otherAccount = Boolean(session?.user?.id) && session?.user?.id !== link.userId;
    return <ConfirmEmailForm token={link.token} maskedEmail={link.maskedEmail} viewer={{ ...viewer, otherAccount }} />;
  }
  return <ConfirmEmailResult outcome={link.kind} viewer={viewer} />;
}

/** The checks the confirmation repeats when the button is pressed: an unspent, unexpired change link for an ACTIVE account. */
async function checkLink(token: string | undefined): Promise<LinkState> {
  if (!token) return { kind: "missing" };
  try {
    const link = await peekAccountToken(db, { token, purpose: "EMAIL_CHANGE" });
    if (!link.ok) return { kind: link.reason };
    const account = await db.user.findUnique({ where: { id: link.userId }, select: { status: true } });
    if (account?.status !== "ACTIVE") return { kind: "invalid" };
    return { kind: "valid", token, maskedEmail: maskEmail(link.email), userId: link.userId };
  } catch (error) {
    if (isSchemaBehindCode(error)) {
      console.error(`SCHEMA BEHIND CODE in confirm email page: the database is missing ${missingSchemaElement(error)}. Apply the pending Prisma migrations (npx prisma migrate deploy) to this database.`);
    } else {
      console.error("CONFIRM EMAIL PAGE ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
    return { kind: "unavailable" };
  }
}
