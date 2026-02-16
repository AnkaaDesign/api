-- Copy admissional to exp1StartAt where exp1StartAt is not set
UPDATE "User" SET "exp1StartAt" = "admissional" WHERE "exp1StartAt" IS NULL AND "admissional" IS NOT NULL;

-- Drop the index
DROP INDEX IF EXISTS "User_admissional_idx";

-- Drop the column
ALTER TABLE "User" DROP COLUMN IF EXISTS "admissional";
