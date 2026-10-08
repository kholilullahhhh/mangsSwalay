-- Expiry captured at ordering time.
--
-- The batch created on receipt used to be stamped with a hardcoded
-- "now + 90 days", which put an invented shelf life in front of the operator on
-- every expiry screen, alert and write-off decision. The real date is read off
-- the packaging at ordering time, so it travels with the purchase line.
ALTER TABLE "PurchaseItem" ADD COLUMN "expiryDate" TIMESTAMP(3);
ALTER TABLE "PurchaseItem" ADD COLUMN "batchNumber" TEXT;

-- Database-level invariants.
--
-- The application already refuses to take stock below zero, but that check lives
-- in one module and any raw query, migration or admin script bypasses it. A
-- negative counter is unrecoverable by design, so the constraint belongs where
-- it cannot be forgotten.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_stock_non_negative" CHECK ("stock" >= 0);

ALTER TABLE "ProductBatch"
  ADD CONSTRAINT "ProductBatch_quantity_non_negative" CHECK ("quantity" >= 0);

-- One open till per cashier.
--
-- Two open shifts make "the drawer" ambiguous and the variance at close
-- meaningless, which is the entire point of the shift. Application checks are a
-- read-then-write race; a partial unique index settles it in the database.
CREATE UNIQUE INDEX "CashShift_one_open_per_user"
  ON "CashShift" ("userId")
  WHERE status = 'OPEN';