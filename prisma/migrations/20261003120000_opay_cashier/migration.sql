-- Add OPay without rewriting the already recorded payment lifecycle migration.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'OPAY';

ALTER TABLE "Payment"
  ADD COLUMN "providerCheckoutReference" TEXT,
  ADD COLUMN "cashierUrl" TEXT;

CREATE UNIQUE INDEX "Payment_providerCheckoutReference_key"
  ON "Payment"("providerCheckoutReference");
