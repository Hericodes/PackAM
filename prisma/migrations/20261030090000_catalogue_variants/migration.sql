-- Flexible catalogue: category display order, subcategories, product labels, per-product option groups
-- and variants with their own price and optional stock, optional stock on simple products, and the chosen
-- variant on cart lines and order items.
--
-- Additive only: no table, column or row is renamed or deleted, and every new column is nullable or has a
-- default. Existing products keep working unchanged as simple products with untracked stock (null).
--
-- Rollback: before any variants, labels or subcategories exist, every statement can be reversed. Once
-- orders reference variants, OrderItem."variantId" and the frozen option values in OrderItem."details"
-- record what was bought; drop them only if that history no longer matters.

-- Category: display order.
ALTER TABLE "Category" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Subcategory: belongs to one category; slugs are unique within it.
CREATE TABLE "Subcategory" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subcategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Subcategory_name_check" CHECK (length(btrim("name")) > 0 AND length("slug") > 0)
);
CREATE UNIQUE INDEX "Subcategory_categoryId_slug_key" ON "Subcategory"("categoryId", "slug");
CREATE INDEX "Subcategory_categoryId_isActive_idx" ON "Subcategory"("categoryId", "isActive");
ALTER TABLE "Subcategory" ADD CONSTRAINT "Subcategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Product: optional subcategory and optional stock (null = not tracked, as before).
ALTER TABLE "Product" ADD COLUMN "subcategoryId" TEXT,
ADD COLUMN "stockQuantity" INTEGER;
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_not_negative_check" CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0);
CREATE INDEX "Product_subcategoryId_idx" ON "Product"("subcategoryId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A product's subcategory must belong to the product's own category. (Prisma can't express this as a
-- two-column foreign key when the subcategory is optional, so a trigger enforces it.)
CREATE FUNCTION "packam_product_subcategory_matches_category"() RETURNS trigger AS $$
BEGIN
  IF NEW."subcategoryId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Subcategory" s WHERE s."id" = NEW."subcategoryId" AND s."categoryId" = NEW."categoryId"
  ) THEN
    RAISE EXCEPTION 'Product subcategory must belong to the product''s category' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Product_subcategory_matches_category"
  BEFORE INSERT OR UPDATE OF "subcategoryId", "categoryId" ON "Product"
  FOR EACH ROW EXECUTE FUNCTION "packam_product_subcategory_matches_category"();

-- A subcategory that has products can't be moved to another category.
CREATE FUNCTION "packam_subcategory_keeps_category"() RETURNS trigger AS $$
BEGIN
  IF NEW."categoryId" <> OLD."categoryId" AND EXISTS (SELECT 1 FROM "Product" p WHERE p."subcategoryId" = OLD."id") THEN
    RAISE EXCEPTION 'A subcategory with products cannot move to another category' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Subcategory_keeps_category"
  BEFORE UPDATE OF "categoryId" ON "Subcategory"
  FOR EACH ROW EXECUTE FUNCTION "packam_subcategory_keeps_category"();

-- Labels and the products that carry them.
CREATE TABLE "ProductLabel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductLabel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductLabel_name_check" CHECK (length(btrim("name")) > 0 AND length("slug") > 0)
);
CREATE UNIQUE INDEX "ProductLabel_slug_key" ON "ProductLabel"("slug");
CREATE TABLE "ProductLabelOnProduct" (
    "productId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    CONSTRAINT "ProductLabelOnProduct_pkey" PRIMARY KEY ("productId","labelId")
);
CREATE INDEX "ProductLabelOnProduct_labelId_idx" ON "ProductLabelOnProduct"("labelId");
ALTER TABLE "ProductLabelOnProduct" ADD CONSTRAINT "ProductLabelOnProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductLabelOnProduct" ADD CONSTRAINT "ProductLabelOnProduct_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "ProductLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Option groups and their values, per product.
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductOption_name_check" CHECK (length(btrim("name")) > 0)
);
CREATE UNIQUE INDEX "ProductOption_productId_name_key" ON "ProductOption"("productId", "name");
CREATE INDEX "ProductOption_productId_position_idx" ON "ProductOption"("productId", "position");
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "ProductOptionValue" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProductOptionValue_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductOptionValue_value_check" CHECK (length(btrim("value")) > 0)
);
CREATE UNIQUE INDEX "ProductOptionValue_optionId_value_key" ON "ProductOptionValue"("optionId", "value");
CREATE INDEX "ProductOptionValue_optionId_position_idx" ON "ProductOptionValue"("optionId", "position");
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Variants: one per combination (unique optionKey per product), price >= 1, stock never negative.
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "optionKey" TEXT NOT NULL,
    "sku" TEXT,
    "price" INTEGER NOT NULL,
    "stockQuantity" INTEGER,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductVariant_price_check" CHECK ("price" >= 1),
    CONSTRAINT "ProductVariant_stock_not_negative_check" CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0),
    CONSTRAINT "ProductVariant_option_key_check" CHECK (length("optionKey") > 0)
);
CREATE UNIQUE INDEX "ProductVariant_productId_optionKey_key" ON "ProductVariant"("productId", "optionKey");
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE INDEX "ProductVariant_productId_status_idx" ON "ProductVariant"("productId", "status");
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "ProductVariantValue" (
    "variantId" TEXT NOT NULL,
    "optionValueId" TEXT NOT NULL,
    CONSTRAINT "ProductVariantValue_pkey" PRIMARY KEY ("variantId","optionValueId")
);
CREATE INDEX "ProductVariantValue_optionValueId_idx" ON "ProductVariantValue"("optionValueId");
ALTER TABLE "ProductVariantValue" ADD CONSTRAINT "ProductVariantValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- NO ACTION (checked at the end of the statement) so deleting a whole product cascades cleanly.
ALTER TABLE "ProductVariantValue" ADD CONSTRAINT "ProductVariantValue_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "ProductOptionValue"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Cart lines and order items may point at the chosen variant.
ALTER TABLE "CartItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD COLUMN "variantId" TEXT;
-- An order keeps its frozen copy in details even if the variant is ever removed.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A cart line's variant must belong to that line's product.
CREATE FUNCTION "packam_cart_variant_matches_product"() RETURNS trigger AS $$
BEGIN
  IF NEW."variantId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProductVariant" v WHERE v."id" = NEW."variantId" AND v."productId" = NEW."productId"
  ) THEN
    RAISE EXCEPTION 'Cart variant must belong to the cart line''s product' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CartItem_variant_matches_product"
  BEFORE INSERT OR UPDATE OF "variantId", "productId" ON "CartItem"
  FOR EACH ROW EXECUTE FUNCTION "packam_cart_variant_matches_product"();
