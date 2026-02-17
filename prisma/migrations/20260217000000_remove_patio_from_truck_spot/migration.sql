-- Update all trucks with PATIO spot to NULL (patio is now represented by null)
UPDATE "Truck" SET "spot" = NULL WHERE "spot" = 'PATIO';

-- Remove PATIO from TRUCK_SPOT enum
ALTER TYPE "TRUCK_SPOT" RENAME TO "TRUCK_SPOT_old";

CREATE TYPE "TRUCK_SPOT" AS ENUM (
  'B1_F1_V1', 'B1_F1_V2', 'B1_F1_V3',
  'B1_F2_V1', 'B1_F2_V2', 'B1_F2_V3',
  'B1_F3_V1', 'B1_F3_V2', 'B1_F3_V3',
  'B2_F1_V1', 'B2_F1_V2', 'B2_F1_V3',
  'B2_F2_V1', 'B2_F2_V2', 'B2_F2_V3',
  'B2_F3_V1', 'B2_F3_V2', 'B2_F3_V3',
  'B3_F1_V1', 'B3_F1_V2', 'B3_F1_V3',
  'B3_F2_V1', 'B3_F2_V2', 'B3_F2_V3',
  'B3_F3_V1', 'B3_F3_V2', 'B3_F3_V3'
);

ALTER TABLE "Truck" ALTER COLUMN "spot" TYPE "TRUCK_SPOT" USING "spot"::text::"TRUCK_SPOT";

DROP TYPE "TRUCK_SPOT_old";
