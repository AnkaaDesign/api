-- CreateEnum
CREATE TYPE "TRUCK_SPOT" AS ENUM (
  'B1_A1', 'B1_A2', 'B1_A3',
  'B1_B1', 'B1_B2', 'B1_B3',
  'B1_C1', 'B1_C2', 'B1_C3',
  'B2_A1', 'B2_A2', 'B2_A3',
  'B2_B1', 'B2_B2', 'B2_B3',
  'B2_C1', 'B2_C2', 'B2_C3',
  'B3_A1', 'B3_A2', 'B3_A3',
  'B3_B1', 'B3_B2', 'B3_B3',
  'B3_C1', 'B3_C2', 'B3_C3',
  'PATIO'
);

-- Remove old Garage relation from Truck
ALTER TABLE "Truck" DROP CONSTRAINT IF EXISTS "Truck_garageId_fkey";
DROP INDEX IF EXISTS "Truck_garageId_idx";

-- Remove old columns
ALTER TABLE "Truck" DROP COLUMN IF EXISTS "garageId";
ALTER TABLE "Truck" DROP COLUMN IF EXISTS "xPosition";
ALTER TABLE "Truck" DROP COLUMN IF EXISTS "yPosition";

-- Add spot column
ALTER TABLE "Truck" ADD COLUMN "spot" "TRUCK_SPOT";

-- Add index on spot
CREATE INDEX "Truck_spot_idx" ON "Truck"("spot");

-- Drop Garage table if it exists
DROP TABLE IF EXISTS "Garage";
