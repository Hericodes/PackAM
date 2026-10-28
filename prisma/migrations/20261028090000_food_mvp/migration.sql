-- Food MVP: food shops on Vendor, menu items on Product, built plates in the cart, and the shop and
-- frozen plate details on orders. Additive only: no table, column or row is renamed or deleted, every
-- new column is nullable or has a default, so existing vendors, products, carts, orders and payments
-- stay valid unchanged. Existing vendors start unlisted and closed (students see nothing new).
--
-- Rollback: before any food data exists, every statement below can be reversed (drop the new table,
-- columns, constraints, indexes and enum, and restore CartItem_cartId_productId_key). Once students
-- have built plates, two cart lines may share a product (different configKey), so the old unique index
-- can only be restored after merging or removing those lines; and once food orders exist, dropping
-- Order.shopId or OrderItem.details would erase which shop a paid order came from and what was on the
-- plate. Prefer leaving these columns in place and hiding Food instead of rolling back.

-- CreateEnum
CREATE TYPE "FoodRole" AS ENUM ('MEAL', 'BASE', 'SOUP', 'EXTRA');

-- Vendor: public food-shop fields. Closed and unlisted by default.
ALTER TABLE "Vendor" ADD COLUMN "description" TEXT,
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "isOpen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "listedInFood" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Vendor_listedInFood_idx" ON "Vendor"("listedInFood");

-- Product: a food menu item belongs to one shop and has a role. Null for every existing product.
ALTER TABLE "Product" ADD COLUMN "shopId" TEXT,
ADD COLUMN "foodRole" "FoodRole",
ADD COLUMN "menuSection" TEXT,
ADD COLUMN "maxPerPlate" INTEGER;
CREATE INDEX "Product_shopId_status_idx" ON "Product"("shopId", "status");
-- A shop that has menu items can't be deleted; hide it instead.
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Shop and role are set together: a food item always has both, a marketplace product neither.
ALTER TABLE "Product" ADD CONSTRAINT "Product_food_fields_together_check" CHECK (("shopId" IS NULL) = ("foodRole" IS NULL));
-- Only extras have a per-plate maximum, and it is never above the approved limit of 5.
ALTER TABLE "Product" ADD CONSTRAINT "Product_max_per_plate_check" CHECK ("maxPerPlate" IS NULL OR ("foodRole" = 'EXTRA' AND "maxPerPlate" BETWEEN 1 AND 5));

-- CartItem: a configuration key so different plates on the same base are separate lines. Existing rows
-- get '' and keep their one-line-per-product behaviour. The new unique index is created before the old
-- one is dropped, so uniqueness is never missing.
ALTER TABLE "CartItem" ADD COLUMN "configKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_config_key_length_check" CHECK (length("configKey") <= 500);
CREATE UNIQUE INDEX "CartItem_cartId_productId_configKey_key" ON "CartItem"("cartId", "productId", "configKey");
DROP INDEX "CartItem_cartId_productId_key";

-- CartItemExtra: the soup and extras chosen for a plate in the cart (no prices stored here).
CREATE TABLE "CartItemExtra" (
    "id" TEXT NOT NULL,
    "cartItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "CartItemExtra_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CartItemExtra_quantity_check" CHECK ("quantity" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "CartItemExtra_cartItemId_productId_key" ON "CartItemExtra"("cartItemId", "productId");
CREATE INDEX "CartItemExtra_productId_idx" ON "CartItemExtra"("productId");
ALTER TABLE "CartItemExtra" ADD CONSTRAINT "CartItemExtra_cartItemId_fkey" FOREIGN KEY ("cartItemId") REFERENCES "CartItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItemExtra" ADD CONSTRAINT "CartItemExtra_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Order: the food shop, kept for the life of the order (a shop with orders can't be deleted).
ALTER TABLE "Order" ADD COLUMN "shopId" TEXT;
CREATE INDEX "Order_shopId_idx" ON "Order"("shopId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OrderItem: the frozen meal or plate at purchase. Null for existing and marketplace items.
ALTER TABLE "OrderItem" ADD COLUMN "details" JSONB;
