-- Takeaway packs: every food plate and ready-made meal is sold with one pack, priced per shop.
-- Additive: one column with a default (metadata-only on Postgres 11+, no table rewrite) and one CHECK.
-- Every existing shop starts at ₦300; an admin can change it per shop, or set 0 for no pack charge.
-- NOT lag-safe for code: Vendor gains a column, so apply this BEFORE deploying the code that reads it.
-- Rollback: ALTER TABLE "Vendor" DROP CONSTRAINT "Vendor_food_pack_fee_check"; ALTER TABLE "Vendor" DROP COLUMN "foodPackFee";
BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "Vendor" ADD COLUMN "foodPackFee" INTEGER NOT NULL DEFAULT 300;

-- Whole naira, ₦0 (no pack charge) up to ₦100,000.
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_food_pack_fee_check" CHECK ("foodPackFee" BETWEEN 0 AND 100000);

COMMIT;
