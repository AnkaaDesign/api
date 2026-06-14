-- Postit free-canvas placement + size (nullable; legacy notes fall back to grid layout)
ALTER TABLE "Postit" ADD COLUMN IF NOT EXISTS "positionX" DOUBLE PRECISION;
ALTER TABLE "Postit" ADD COLUMN IF NOT EXISTS "positionY" DOUBLE PRECISION;
ALTER TABLE "Postit" ADD COLUMN IF NOT EXISTS "width" DOUBLE PRECISION;
ALTER TABLE "Postit" ADD COLUMN IF NOT EXISTS "height" DOUBLE PRECISION;
