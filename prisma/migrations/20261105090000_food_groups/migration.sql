-- Food groups: what kind of plate base or add-on a food menu item is, so the student menu can show
-- Swallow / Rice / Others and Protein / Sides / Drinks, and the plate rules can follow them (a swallow
-- plate needs a soup; a rice or other plate takes none). And soups may now be free (₦0).
--
-- Additive: one enum, one nullable column and one new CHECK. Every existing item keeps foodGroup NULL and
-- works exactly as before (a base without a group keeps soup optional). The only changed rule is the
-- active-price CHECK, which is widened (never narrowed): an active SOUP may cost ₦0; everything else
-- still needs at least ₦1. It stays NOT VALID like the original, so existing rows aren't re-checked.
--
-- NOT lag-safe for code: Product gains a column, so apply this BEFORE deploying the code that reads it.
-- Rollback: ALTER TABLE "Product" DROP CONSTRAINT "Product_food_group_matches_role_check";
--   ALTER TABLE "Product" DROP COLUMN "foodGroup"; DROP TYPE "FoodGroup";
--   and restore the original price CHECK (only once no active ₦0 soup exists).
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TYPE "FoodGroup" AS ENUM ('SWALLOW', 'RICE', 'OTHER', 'PROTEIN', 'SIDE', 'DRINK');

ALTER TABLE "Product" ADD COLUMN "foodGroup" "FoodGroup";

-- A group belongs to its role: bases are Swallow, Rice or Other; add-ons are Protein, Side or Drink.
-- IS NOT DISTINCT FROM: a NULL foodRole must make the check FALSE, not NULL (a CHECK lets NULL through).
ALTER TABLE "Product" ADD CONSTRAINT "Product_food_group_matches_role_check" CHECK (
  "foodGroup" IS NULL
  OR ("foodRole" IS NOT DISTINCT FROM 'BASE' AND "foodGroup" IN ('SWALLOW', 'RICE', 'OTHER'))
  OR ("foodRole" IS NOT DISTINCT FROM 'EXTRA' AND "foodGroup" IN ('PROTEIN', 'SIDE', 'DRINK'))
);

-- Free soups: an active soup may cost ₦0; every other active product still needs at least ₦1.
ALTER TABLE "Product" DROP CONSTRAINT "Product_active_requires_price_check";
ALTER TABLE "Product" ADD CONSTRAINT "Product_active_requires_price_check"
  CHECK ("status" <> 'ACTIVE' OR "customerPrice" >= 1 OR ("foodRole" IS NOT DISTINCT FROM 'SOUP' AND "customerPrice" = 0)) NOT VALID;

COMMIT;
