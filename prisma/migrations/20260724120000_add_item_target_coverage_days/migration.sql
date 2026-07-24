-- Explicit per-item coverage horizon (days) that overrides the ABC/XYZ matrix
-- targetStockDays when computing maxQuantity. Null = use the matrix.
ALTER TABLE "Item" ADD COLUMN "targetCoverageDays" INTEGER;
