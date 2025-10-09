-- Fix phone field to properly handle NULL values in unique constraint
-- This migration converts empty strings to NULL to prevent unique constraint violations

-- Step 1: Update empty phone strings to NULL
UPDATE "User" SET phone = NULL WHERE phone = '';

-- Step 2: Drop the existing unique constraint
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_phone_key";

-- Step 3: Recreate the unique constraint (PostgreSQL automatically allows multiple NULLs)
ALTER TABLE "User" ADD CONSTRAINT "User_phone_key" UNIQUE (phone);

-- Step 4: Update the phone column to use VARCHAR(20) for consistency
ALTER TABLE "User" ALTER COLUMN phone TYPE VARCHAR(20);
