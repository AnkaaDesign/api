-- Structured temporary (off-catalog) order-item fields.
-- Replaces the single mashed `temporaryItemDescription` string with discrete
-- columns; temporaryItemDescription becomes the pure name. temporaryItemCategoryId
-- lets a temp line carry the ItemCategory the user picked so the reconciliation
-- classifier can categorize the matching NF/transaction from the order.
ALTER TABLE "OrderItem"
  ADD COLUMN "temporaryItemUniCode"    TEXT,
  ADD COLUMN "temporaryItemBrand"      TEXT,
  ADD COLUMN "temporaryItemMeasures"   TEXT,
  ADD COLUMN "temporaryItemCategoryId" TEXT;

CREATE INDEX "OrderItem_temporaryItemCategoryId_idx" ON "OrderItem"("temporaryItemCategoryId");

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_temporaryItemCategoryId_fkey"
  FOREIGN KEY ("temporaryItemCategoryId") REFERENCES "ItemCategory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Resolved Order backbone for fiscal-document order codes. Lets an NF flow back
-- to its purchase Order for reconciliation clearing + order-derived categorization.
ALTER TABLE "FiscalDocumentOrderCode" ADD COLUMN "orderId" TEXT;

CREATE INDEX "FiscalDocumentOrderCode_orderId_idx" ON "FiscalDocumentOrderCode"("orderId");

ALTER TABLE "FiscalDocumentOrderCode" ADD CONSTRAINT "FiscalDocumentOrderCode_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
