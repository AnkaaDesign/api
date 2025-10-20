-- AlterTable
ALTER TABLE "Garage" ADD COLUMN "isVirtual" BOOLEAN NOT NULL DEFAULT false;

-- Create virtual Patio garage if it doesn't exist
INSERT INTO "Garage" (id, name, width, length, "isVirtual", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  'Patio',
  0,
  0,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Garage" WHERE name = 'Patio' AND "isVirtual" = true
);
