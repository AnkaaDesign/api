-- Manual grand-total override for an order (Valor Total).
-- Nullable: NULL = use the computed total (items − discount + freight).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "totalOverride" DOUBLE PRECISION;
