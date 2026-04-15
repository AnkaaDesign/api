-- AlterEnum
-- Add SEMI_TRAILER_2_AXLES and BITRUCK to TruckCategory enum

ALTER TYPE "TruckCategory" ADD VALUE 'SEMI_TRAILER_2_AXLES';
ALTER TYPE "TruckCategory" ADD VALUE 'BITRUCK';
