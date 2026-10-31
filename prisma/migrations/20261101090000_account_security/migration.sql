-- Account security: email verification state, a session version that signs an account out on every device,
-- the time of the last password change, and one-time emailed link tokens (verification, reset, email change).
--
-- Additive only: three new User columns (two nullable, one with a default) and one new table. No existing row
-- is changed: every account starts unconfirmed (nothing is blocked by that yet) at session version 0, which is
-- also what src/auth.ts assumes for session cookies issued before this release.
-- No raw tokens are stored: AccountToken keeps only the SHA-256 of each emailed token, and its rows are
-- deleted with their user.
--
-- Rollback: DROP TABLE "AccountToken"; DROP TYPE "AccountTokenPurpose";
-- ALTER TABLE "User" DROP COLUMN "emailVerifiedAt", DROP COLUMN "sessionVersion", DROP COLUMN "passwordChangedAt";
-- Dropping the columns forgets every confirmed email, and cookies from devices that were signed out by a
-- version bump would be accepted again. Login keeps working either way: src/auth.ts falls back to the older
-- columns while these are missing.

-- CreateEnum
CREATE TYPE "AccountTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMAIL_CHANGE');

-- User: null = not confirmed; the session version starts at 0 for everyone.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccountToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AccountTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id"),
    -- A SHA-256 hex digest, never a raw token.
    CONSTRAINT "AccountToken_tokenHash_check" CHECK (length("tokenHash") = 64),
    CONSTRAINT "AccountToken_expiry_check" CHECK ("expiresAt" > "createdAt")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE INDEX "AccountToken_userId_purpose_idx" ON "AccountToken"("userId", "purpose");
CREATE INDEX "AccountToken_expiresAt_idx" ON "AccountToken"("expiresAt");

-- AddForeignKey: a user's tokens go with them.
ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
