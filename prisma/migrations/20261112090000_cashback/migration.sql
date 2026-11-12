-- Cashback: a naira balance students earn on delivered orders and print jobs, and spend at shop and food checkout.
--
-- Additive only: one enum and two new tables. No existing table, column or row is changed, so code from before
-- this migration keeps working, and the new code runs on a database without it (cashback is then simply
-- unavailable: nothing is earned, checkout doesn't offer it, and the admin page explains).
--   * CashbackSettings: one row ("default"): whether delivered orders earn, the % back (0-50) and the welcome bonus
--     (naira, after a student's first delivery). Seeded switched off, 2%, no bonus: an admin turns it on.
--   * CashbackEntry: every change to a balance. EARNED and WELCOME add (amount > 0); SPENT takes away (amount < 0,
--     tied to its payment); ADJUSTMENT is an admin's change either way, with who and why. "key" is unique per source,
--     so nothing is credited or spent twice. A SPENT row whose payment fails, is cancelled or refunded stops counting,
--     so that cashback comes back by itself.
-- Cashback comes off the items only; the delivery fee is always paid, so no payment is ever 0.
--
-- Explicit transaction: Prisma does not wrap a migration file in one.
-- lock_timeout: the foreign key briefly locks "User"; fail fast (and retry later) rather than queue behind a long
-- transaction and hold up sign-ins.
--
-- Rollback (only while no payment that used cashback is pending; checkout then stops offering it):
--   DROP TABLE "CashbackEntry"; DROP TABLE "CashbackSettings"; DROP TYPE "CashbackKind";
BEGIN;

SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "CashbackKind" AS ENUM ('EARNED', 'WELCOME', 'ADJUSTMENT', 'SPENT');

-- CreateTable
CREATE TABLE "CashbackSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ratePercent" INTEGER NOT NULL DEFAULT 2,
    "welcomeBonus" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashbackSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CashbackSettings_single_row_check" CHECK ("id" = 'default'),
    CONSTRAINT "CashbackSettings_rate_check" CHECK ("ratePercent" BETWEEN 0 AND 50),
    CONSTRAINT "CashbackSettings_welcome_check" CHECK ("welcomeBonus" BETWEEN 0 AND 100000)
);

-- CreateTable
CREATE TABLE "CashbackEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CashbackKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "orderId" TEXT,
    "printJobId" TEXT,
    "paymentId" TEXT,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashbackEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CashbackEntry_kind_amount_check" CHECK (
        ("kind" IN ('EARNED', 'WELCOME') AND "amount" > 0)
        OR ("kind" = 'SPENT' AND "amount" < 0 AND "paymentId" IS NOT NULL)
        OR ("kind" = 'ADJUSTMENT' AND "amount" <> 0 AND "actorId" IS NOT NULL AND "note" IS NOT NULL)
    ),
    CONSTRAINT "CashbackEntry_amount_range_check" CHECK ("amount" BETWEEN -1000000 AND 1000000)
);

-- CreateIndex
CREATE UNIQUE INDEX "CashbackEntry_key_key" ON "CashbackEntry"("key");

-- CreateIndex
CREATE INDEX "CashbackEntry_userId_createdAt_idx" ON "CashbackEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CashbackEntry_paymentId_idx" ON "CashbackEntry"("paymentId");

-- AddForeignKey
ALTER TABLE "CashbackEntry" ADD CONSTRAINT "CashbackEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: switched off, 2% back, no welcome bonus. Admin -> Cashback turns it on.
INSERT INTO "CashbackSettings" ("id", "enabled", "ratePercent", "welcomeBonus", "updatedAt") VALUES ('default', false, 2, 0, CURRENT_TIMESTAMP);

COMMIT;
