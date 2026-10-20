-- An ACTIVE (purchasable) product must have a real customer price of at least ₦1.
--
-- Products can now be created before their price is confirmed. Such products store
-- customerPrice = 0 ("price not set") and must stay INACTIVE. The products API, the student
-- catalogue filter and checkout already refuse ₦0 products; this makes the database refuse an
-- ACTIVE ₦0 product too, whatever code path writes it.
--
-- Additive and non-destructive: no data changes. NOT VALID means existing rows are not re-checked
-- during this migration (so it cannot fail on legacy data), while every new INSERT and UPDATE is.
-- Prisma cannot express CHECK constraints; see the comment on the Product model.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_active_requires_price_check"
  CHECK ("status" <> 'ACTIVE' OR "customerPrice" >= 1) NOT VALID;
