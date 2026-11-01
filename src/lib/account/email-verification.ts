import "server-only";

import { db } from "../db";
import { consumeAccountToken, peekAccountToken } from "./account-tokens";
import { hashToken, isWellFormedToken } from "./tokens";
import { maskEmail } from "./validation";

/**
 * Email confirmation links (POST /api/account/verify-email and the /verify-email page). Opening a link only shows a
 * page; the address is confirmed when the person presses "Confirm my email" there. Mail scanners and link previews
 * open links but don't press buttons, so a confirmed address means a person read that inbox, and only then do emails
 * to it use the account's name or skip the shared per-inbox limit.
 */

/** How pressing "Confirm my email" ended. */
export type VerifyStatus = "verified" | "already" | "expired" | "used" | "invalid";

/** What the page can say about a link before anything is pressed. */
export type VerificationLink = { kind: "valid"; maskedEmail: string } | { kind: Exclude<VerifyStatus, "verified"> };

/**
 * Uses the link up and confirms the address, but only while it is still the account's email (a link sent before an
 * email change proves nothing about the new address). A spent or expired link whose address is confirmed by now
 * answers "already", as does a link for an address confirmed some other way (a password reset).
 */
export async function confirmEmailAddress(token: unknown, now = new Date()): Promise<VerifyStatus> {
  const status = await db.$transaction(async (tx): Promise<VerifyStatus> => {
    const claimed = await consumeAccountToken(tx, { token, purpose: "EMAIL_VERIFICATION", now });
    if (!claimed.ok) return claimed.reason;
    // Conditional, so an email change landing at the same moment can never be confirmed by the old link.
    const confirmed = await tx.user.updateMany({
      where: { id: claimed.userId, email: claimed.email, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    });
    if (confirmed.count === 1) return "verified";
    const account = await tx.user.findUnique({ where: { id: claimed.userId }, select: { email: true, emailVerifiedAt: true } });
    return account?.email === claimed.email && account.emailVerifiedAt ? "already" : "invalid";
  });
  if ((status === "used" || status === "expired") && (await alreadyConfirmed(token))) return "already";
  return status;
}

/** The same checks as confirmEmailAddress() without using the link up: whether the page offers the button. */
export async function checkVerificationLink(token: string): Promise<VerificationLink> {
  const link = await peekAccountToken(db, { token, purpose: "EMAIL_VERIFICATION" });
  if (!link.ok) {
    return (link.reason === "used" || link.reason === "expired") && (await alreadyConfirmed(token)) ? { kind: "already" } : { kind: link.reason };
  }
  const account = await db.user.findUnique({ where: { id: link.userId }, select: { email: true, emailVerifiedAt: true } });
  if (account?.email !== link.email) return { kind: "invalid" };
  if (account.emailVerifiedAt) return { kind: "already" };
  return { kind: "valid", maskedEmail: maskEmail(link.email) };
}

/** Whether a spent or expired link's address is, by now, the account's confirmed email. */
async function alreadyConfirmed(token: unknown) {
  if (!isWellFormedToken(token)) return false;
  const link = await db.accountToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { email: true, user: { select: { email: true, emailVerifiedAt: true } } },
  });
  return Boolean(link?.user.emailVerifiedAt && link.user.email === link.email);
}
