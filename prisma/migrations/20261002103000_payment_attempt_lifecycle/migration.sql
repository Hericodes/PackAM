-- Allow Payment to represent a pending provider attempt before an Order exists.
ALTER TABLE "Payment" ADD COLUMN "userId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "checkoutSnapshot" JSONB;
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;

-- Preserve ownership for existing order-linked payment rows.
UPDATE "Payment" AS payment
SET "userId" = "Order"."userId"
FROM "Order"
WHERE payment."orderId" = "Order"."id";

ALTER TABLE "Payment" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Payment_providerReference_key"
  ON "Payment"("providerReference");
CREATE UNIQUE INDEX "Payment_userId_idempotencyKey_key"
  ON "Payment"("userId", "idempotencyKey");
CREATE INDEX "Payment_userId_createdAt_idx"
  ON "Payment"("userId", "createdAt");

-- A successful payment and its order must commit together.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_success_requires_order_check"
  CHECK ("status" <> 'SUCCESS' OR "orderId" IS NOT NULL);

