-- A successful payment must commit together with exactly one thing it paid for.
--
-- The original rule (20261002103000) predates printing and required every SUCCESS payment to have
-- an Order. Print payments are fulfilled by a PrintJob and deliberately have no Order, so that rule
-- rejected every print payment. This migration replaces it with the full invariant:
--   * a SUCCESS payment has an Order or a PrintJob (never neither);
--   * no payment ever references both an Order and a PrintJob;
--   * a PrintJob has at most one SUCCESS payment (Orders already have one via Payment_orderId_key).
-- No rows are changed.
--
-- Explicit transaction: Prisma does not wrap a migration file in one. Without it, a failure after
-- the DROP would leave "Payment" with no success rule at all. New rules are added before the old
-- rule is dropped, so the table is never unprotected even mid-transaction.
-- Pre-deploy checks that must return 0 rows/0 on the target database are in the review notes.
BEGIN;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_success_requires_fulfilment_root_check"
  CHECK ("status" <> 'SUCCESS' OR "orderId" IS NOT NULL OR "printJobId" IS NOT NULL);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_single_fulfilment_root_check"
  CHECK ("orderId" IS NULL OR "printJobId" IS NULL);

-- Partial unique index; declared in schema.prisma with the partialIndexes preview feature.
CREATE UNIQUE INDEX "Payment_one_success_per_print_job"
  ON "Payment"("printJobId") WHERE ("status" = 'SUCCESS');

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_success_requires_order_check";

COMMIT;
