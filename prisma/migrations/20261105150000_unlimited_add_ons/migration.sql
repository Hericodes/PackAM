-- Add-ons without the 5-per-plate limit: a student may add as many of one add-on (beef, fish…) to a plate as they
-- want. The only bound left is a safety ceiling of 99 per add-on per plate, matching the cart's per-line quantity
-- limit. An admin may still set a lower limit on one item (maxPerPlate), now anything from 1 to 99.
--
-- Widens two CHECKs (never narrows): every row that passes today still passes. No data changes.
-- NOT lag-safe the other way round: code allowing more than 5 must not deploy before this migration.
-- Rollback (only while no cart line holds more than 5 of an add-on and no item's limit is above 5): restore
--   "CartItemExtra_quantity_check" CHECK ("quantity" BETWEEN 1 AND 5) and
--   "Product_max_per_plate_check" CHECK ("maxPerPlate" IS NULL OR ("foodRole" = 'EXTRA' AND "maxPerPlate" BETWEEN 1 AND 5)).
BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "CartItemExtra" DROP CONSTRAINT "CartItemExtra_quantity_check";
ALTER TABLE "CartItemExtra" ADD CONSTRAINT "CartItemExtra_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99);

-- IS NOT DISTINCT FROM: a NULL foodRole makes the check FALSE, not NULL (a CHECK lets NULL through).
ALTER TABLE "Product" DROP CONSTRAINT "Product_max_per_plate_check";
ALTER TABLE "Product" ADD CONSTRAINT "Product_max_per_plate_check"
  CHECK ("maxPerPlate" IS NULL OR ("foodRole" IS NOT DISTINCT FROM 'EXTRA' AND "maxPerPlate" BETWEEN 1 AND 99));

COMMIT;
