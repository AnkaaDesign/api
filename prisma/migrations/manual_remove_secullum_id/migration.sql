-- Remove secullumId column from User table
-- This migration removes the secullum_id field as it's no longer needed
-- Secullum employee lookup is now done dynamically via CPF/PIS/PayrollNumber

-- Drop the unique index first
DROP INDEX IF EXISTS "User_secullum_id_key";

-- Remove the column
ALTER TABLE "User" DROP COLUMN IF EXISTS "secullum_id";
