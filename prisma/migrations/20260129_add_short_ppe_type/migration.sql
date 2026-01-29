-- Add SHORT to PpeType enum
ALTER TYPE "PpeType" ADD VALUE 'SHORT';

-- Add shorts column to PpeSize table (uses PantsSize enum, same as pants)
ALTER TABLE "PpeSize" ADD COLUMN "shorts" "PantsSize";
