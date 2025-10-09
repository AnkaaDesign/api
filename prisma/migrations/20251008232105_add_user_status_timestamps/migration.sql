-- Add status timestamp tracking fields to User table
-- These fields track when a user transitions between employment statuses

-- Add contractedAt field (when user became permanently contracted)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contractedAt" TIMESTAMP(3);

-- Add exp1StartAt and exp1EndAt (first experience period - 45 days)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "exp1StartAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "exp1EndAt" TIMESTAMP(3);

-- Add exp2StartAt and exp2EndAt (second experience period - 45 days)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "exp2StartAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "exp2EndAt" TIMESTAMP(3);

-- Add dismissedAt field (when user was dismissed/terminated)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dismissedAt" TIMESTAMP(3);

-- Create indexes for efficient querying of status timestamps
CREATE INDEX IF NOT EXISTS "User_contractedAt_idx" ON "User"("contractedAt");
CREATE INDEX IF NOT EXISTS "User_exp1StartAt_idx" ON "User"("exp1StartAt");
CREATE INDEX IF NOT EXISTS "User_exp1EndAt_idx" ON "User"("exp1EndAt");
CREATE INDEX IF NOT EXISTS "User_exp2StartAt_idx" ON "User"("exp2StartAt");
CREATE INDEX IF NOT EXISTS "User_exp2EndAt_idx" ON "User"("exp2EndAt");
CREATE INDEX IF NOT EXISTS "User_dismissedAt_idx" ON "User"("dismissedAt");

-- Populate timestamps for existing users based on their current status
-- This is a one-time data migration to set historical timestamps

-- For CONTRACTED users, set contractedAt to their admissional date
UPDATE "User"
SET "contractedAt" = "admissional"
WHERE "status" = 'CONTRACTED' AND "contractedAt" IS NULL;

-- For DISMISSED users, set dismissedAt to dismissal date or updatedAt if no dismissal date
UPDATE "User"
SET "dismissedAt" = COALESCE("dismissal", "updatedAt")
WHERE "status" = 'DISMISSED' AND "dismissedAt" IS NULL;

-- For EXPERIENCE_PERIOD_1 users, set exp1StartAt to admissional
UPDATE "User"
SET "exp1StartAt" = "admissional",
    "exp1EndAt" = "admissional" + INTERVAL '45 days'
WHERE "status" = 'EXPERIENCE_PERIOD_1' AND "exp1StartAt" IS NULL;

-- For EXPERIENCE_PERIOD_2 users, set exp2StartAt
-- Assume exp1 was completed, set exp1StartAt and exp1EndAt retroactively
UPDATE "User"
SET "exp1StartAt" = "admissional",
    "exp1EndAt" = "admissional" + INTERVAL '45 days',
    "exp2StartAt" = "admissional" + INTERVAL '45 days',
    "exp2EndAt" = "admissional" + INTERVAL '90 days'
WHERE "status" = 'EXPERIENCE_PERIOD_2' AND "exp2StartAt" IS NULL;
