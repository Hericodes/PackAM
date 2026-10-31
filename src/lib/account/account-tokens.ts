import "server-only";

import type { AccountTokenPurpose, Prisma } from "@prisma/client";
import { hashToken, isWellFormedToken, newToken } from "./tokens";

/**
 * One-time emailed links (email verification, password reset, email change), stored in AccountToken. Only each
 * token's SHA-256 is kept; issueAccountToken() returns the raw token once, for the link, and it is never stored or
 * logged. Pass the transaction that makes the change the link is for, so a link is only used up if that change
 * commits. Every function takes a transaction client or the db client itself.
 */

/** How long each kind of link works. The email copy states the same (src/lib/email/templates.ts). */
export const TOKEN_TTL_MS = {
  PASSWORD_RESET: 30 * 60 * 1000,
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  EMAIL_CHANGE: 24 * 60 * 60 * 1000,
} as const satisfies Record<AccountTokenPurpose, number>;

type TokenStore = Pick<Prisma.TransactionClient, "accountToken">;

export type AccountTokenFailure = "invalid" | "expired" | "used";
export type ConsumedAccountToken = { ok: true; userId: string; email: string; tokenId: string } | { ok: false; reason: AccountTokenFailure };
export type PeekedAccountToken = { ok: true; userId: string; email: string; expiresAt: Date } | { ok: false; reason: AccountTokenFailure };

/**
 * Creates a link token and returns the raw value for the link. The user's older unused links of the same purpose
 * are marked used first, so only the newest one works. `email` is the address the link is sent to (for an email
 * change: the new address).
 */
export async function issueAccountToken(
  tx: TokenStore,
  input: { userId: string; purpose: AccountTokenPurpose; email: string; now?: Date },
): Promise<string> {
  const now = input.now ?? new Date();
  await revokeAccountTokens(tx, { userId: input.userId, purpose: input.purpose, now });
  const token = newToken();
  await tx.accountToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      email: input.email,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[input.purpose]),
    },
    select: { id: true },
  });
  return token;
}

/**
 * Uses up a link: succeeds once per token, only for its purpose and before it expires. The claim is a
 * conditional update (still unused and unexpired), so two requests racing with the same link can't both succeed.
 * `token` can be the raw query value; anything malformed is refused before any query.
 */
export async function consumeAccountToken(
  tx: TokenStore,
  input: { token: unknown; purpose: AccountTokenPurpose; now?: Date },
): Promise<ConsumedAccountToken> {
  const now = input.now ?? new Date();
  const found = await findUsableToken(tx, input.token, input.purpose, now);
  if (!found.ok) return found;
  const claimed = await tx.accountToken.updateMany({
    where: { id: found.row.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  // Another request used the same link between the read and this update.
  if (claimed.count !== 1) return { ok: false, reason: "used" };
  return { ok: true, userId: found.row.userId, email: found.row.email, tokenId: found.row.id };
}

/** The same checks as consumeAccountToken(), without using the link up: for showing a page about it. */
export async function peekAccountToken(
  db: TokenStore,
  input: { token: unknown; purpose: AccountTokenPurpose; now?: Date },
): Promise<PeekedAccountToken> {
  const found = await findUsableToken(db, input.token, input.purpose, input.now ?? new Date());
  if (!found.ok) return found;
  return { ok: true, userId: found.row.userId, email: found.row.email, expiresAt: found.row.expiresAt };
}

/** Marks the user's unused links as used: all of them, or only one purpose. Returns how many were open. */
export async function revokeAccountTokens(
  tx: TokenStore,
  input: { userId: string; purpose?: AccountTokenPurpose; now?: Date },
): Promise<number> {
  const result = await tx.accountToken.updateMany({
    where: { userId: input.userId, usedAt: null, ...(input.purpose ? { purpose: input.purpose } : {}) },
    data: { usedAt: input.now ?? new Date() },
  });
  return result.count;
}

/** The new address of an email change still waiting for confirmation (newest unused, unexpired link), or null. */
export async function findPendingEmailChange(db: TokenStore, userId: string, now = new Date()): Promise<{ email: string; expiresAt: Date } | null> {
  return db.accountToken.findFirst({
    where: { userId, purpose: "EMAIL_CHANGE", usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { email: true, expiresAt: true },
  });
}

async function findUsableToken(db: TokenStore, token: unknown, purpose: AccountTokenPurpose, now: Date) {
  if (!isWellFormedToken(token)) return { ok: false as const, reason: "invalid" as const };
  const row = await db.accountToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, purpose: true, email: true, expiresAt: true, usedAt: true },
  });
  if (!row || row.purpose !== purpose) return { ok: false as const, reason: "invalid" as const };
  if (row.usedAt) return { ok: false as const, reason: "used" as const };
  if (row.expiresAt <= now) return { ok: false as const, reason: "expired" as const };
  return { ok: true as const, row };
}
