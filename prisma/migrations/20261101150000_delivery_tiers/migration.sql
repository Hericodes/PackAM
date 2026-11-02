-- Delivery tiers for marketplace and food orders: Cruise Mode, Sharp Sharp and Oya Now!.
--
-- Additive only: one enum and two new tables. No existing table, column or row is changed, so code from before
-- this migration keeps working, and the delivery-tier code runs on a database without it (Cruise Mode only, ₦200).
--   * DeliveryTierSetting: one row per tier with its fee (whole naira), on/off switch, delivery window and an edit
--     version for optimistic concurrency. Seeded below with the owner-approved prices, all on.
--   * OrderDeliveryTier: the speed, window and due time frozen onto one paid order (1:1, deleted with the order).
--     Orders paid before this migration get no row and show as "Standard delivery". Nothing is backfilled.
-- Printing keeps its own fixed ₦200 delivery fee (PRINT_DELIVERY_FEE); nothing here touches print jobs.
--
-- The enum's declaration order is the dispatch priority (OYA, SHARP, CRUISE): ORDER BY "tier" follows it. Add any
-- future value with an explicit BEFORE/AFTER, or the priority order changes.
-- Prisma cannot express CHECK constraints; see the comments on both models in schema.prisma.
--
-- Explicit transaction: Prisma does not wrap a migration file in one, and the seed must never land partially.
-- lock_timeout: adding the foreign key briefly locks "Order"; fail fast (and retry later) rather than queue
-- behind a long transaction and hold up checkouts.
--
-- Rollback (only while no Oya Now!/Sharp Sharp payment is pending; the app falls back to Cruise Mode only):
--   DROP TABLE "OrderDeliveryTier"; DROP TABLE "DeliveryTierSetting"; DROP TYPE "DeliveryTier";
BEGIN;

SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "DeliveryTier" AS ENUM ('OYA', 'SHARP', 'CRUISE');

-- CreateTable
CREATE TABLE "DeliveryTierSetting" (
    "tier" "DeliveryTier" NOT NULL,
    "fee" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "etaMinMinutes" INTEGER NOT NULL,
    "etaMaxMinutes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryTierSetting_pkey" PRIMARY KEY ("tier"),
    -- A tier that is on must have a price (the admin API refuses it too).
    CONSTRAINT "DeliveryTierSetting_enabled_requires_fee_check" CHECK (NOT "enabled" OR "fee" IS NOT NULL),
    -- Whole naira, at least ₦1.
    CONSTRAINT "DeliveryTierSetting_fee_check" CHECK ("fee" IS NULL OR "fee" > 0),
    CONSTRAINT "DeliveryTierSetting_eta_check" CHECK ("etaMinMinutes" >= 1 AND "etaMaxMinutes" >= "etaMinMinutes" AND "etaMaxMinutes" <= 1440),
    CONSTRAINT "DeliveryTierSetting_version_check" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "OrderDeliveryTier" (
    "orderId" TEXT NOT NULL,
    "tier" "DeliveryTier" NOT NULL,
    "etaMinMinutes" INTEGER NOT NULL,
    "etaMaxMinutes" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "settingsVersion" INTEGER,
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDeliveryTier_pkey" PRIMARY KEY ("orderId"),
    CONSTRAINT "OrderDeliveryTier_eta_check" CHECK ("etaMinMinutes" >= 1 AND "etaMaxMinutes" >= "etaMinMinutes" AND "etaMaxMinutes" <= 1440)
);

-- CreateIndex: waiting urgent orders, highest priority and oldest first (dispatch scan).
CREATE INDEX "OrderDeliveryTier_tier_createdAt_idx" ON "OrderDeliveryTier"("tier", "createdAt");

-- AddForeignKey: the tier snapshot goes with its order.
ALTER TABLE "OrderDeliveryTier" ADD CONSTRAINT "OrderDeliveryTier_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: the owner-approved configuration, all on. UTC timestamps, as Prisma writes them.
INSERT INTO "DeliveryTierSetting" ("tier", "fee", "enabled", "etaMinMinutes", "etaMaxMinutes", "version", "createdAt", "updatedAt") VALUES
    ('CRUISE', 200, true, 20, 30, 1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')),
    ('SHARP', 300, true, 15, 25, 1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')),
    ('OYA', 400, true, 10, 15, 1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'));

COMMIT;
