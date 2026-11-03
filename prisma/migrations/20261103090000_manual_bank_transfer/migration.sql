-- Manual bank-transfer payments: the student pays PackAM's account and an admin confirms the credit by hand.
-- Additive only: one enum value and two nullable columns. No existing row or behaviour changes.
--   * PaymentProvider.MANUAL: attempts created with PAYMENT_PROVIDER=MANUAL.
--   * Payment.transferCode: short unique code (e.g. PK-7F3K9) the student writes in the transfer remark.
--   * Payment.transferClaimedAt: when the student tapped "I've made the payment". A claim is never proof of money.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'MANUAL';

ALTER TABLE "Payment"
  ADD COLUMN "transferCode" TEXT,
  ADD COLUMN "transferClaimedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_transferCode_key" ON "Payment"("transferCode");
