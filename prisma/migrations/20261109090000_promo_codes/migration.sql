-- Promo codes for shop and food checkout.
--
-- Additive only: one enum and two new tables. No existing table, column or row is changed, so code from before
-- this migration keeps working, and the promo code runs on a database without it (promo codes are then simply
-- unavailable: checkout refuses a code with "Promo codes aren't available yet" and the admin page explains).
--   * PromoCode: what admins create. PERCENT (1–100% of the items, optional naira cap) or FIXED (naira off the
--     items). Optional minimum items total, total and per-student use limits, and a start/end window.
--   * PromoRedemption: one row per payment attempt that used a code (1:1 with Payment, deleted with it). It counts
--     as a use only once its payment has succeeded. The money itself stays on the order:
--     total = subtotal + deliveryFee - discount. Nothing is backfilled.
-- Codes come off the items only; the delivery fee is always paid, so no payment is ever ₦0.
-- Printing is not affected.
--
-- Explicit transaction: Prisma does not wrap a migration file in one.
-- lock_timeout: the foreign keys briefly lock "User" and "Payment"; fail fast (and retry later) rather than queue
-- behind a long transaction and hold up sign-ins or checkouts.
--
-- Rollback (only while no payment that used a code is pending; checkout then refuses codes again):
--   DROP TABLE "PromoRedemption"; DROP TABLE "PromoCode"; DROP TYPE "PromoDiscountType";
BEGIN;

SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "PromoDiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "PromoDiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "maxDiscount" INTEGER,
    "minSubtotal" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "maxUsesPerStudent" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id"),
    -- Stored uppercase; what students type is uppercased before matching.
    CONSTRAINT "PromoCode_code_check" CHECK ("code" ~ '^[A-Z0-9]{3,20}$'),
    CONSTRAINT "PromoCode_value_check" CHECK (("type" = 'PERCENT' AND "value" BETWEEN 1 AND 100) OR ("type" = 'FIXED' AND "value" >= 1)),
    -- A naira cap only makes sense on a percentage code.
    CONSTRAINT "PromoCode_max_discount_check" CHECK ("maxDiscount" IS NULL OR ("type" = 'PERCENT' AND "maxDiscount" >= 1)),
    CONSTRAINT "PromoCode_limits_check" CHECK ("minSubtotal" >= 0 AND ("maxUses" IS NULL OR "maxUses" >= 1) AND "maxUsesPerStudent" >= 1),
    CONSTRAINT "PromoCode_window_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "discount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PromoRedemption_discount_check" CHECK ("discount" >= 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex: the admin list, newest first.
CREATE INDEX "PromoCode_active_createdAt_idx" ON "PromoCode"("active", "createdAt");

-- CreateIndex: one code per payment attempt.
CREATE UNIQUE INDEX "PromoRedemption_paymentId_key" ON "PromoRedemption"("paymentId");

-- CreateIndex: counting a code's uses, overall and per student.
CREATE INDEX "PromoRedemption_promoCodeId_idx" ON "PromoRedemption"("promoCodeId");
CREATE INDEX "PromoRedemption_userId_promoCodeId_idx" ON "PromoRedemption"("userId", "promoCodeId");

-- AddForeignKey: a code keeps the admin who created it; a code that was ever used can't be deleted.
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: the redemption goes with its payment attempt.
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
