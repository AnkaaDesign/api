-- Add "plaqueta" (vinPlate) identification field to Truck, mirroring chassisNumber.
-- vinPlateNormalized is a lower(unaccent(...)) generated column for accent-insensitive search,
-- consistent with the other *Normalized columns (see 20260624150000_accent_insensitive_search).

ALTER TABLE "Truck"
  ADD COLUMN IF NOT EXISTS "vinPlate" text;

ALTER TABLE "Truck"
  ADD COLUMN IF NOT EXISTS "vinPlateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("vinPlate"))) STORED;
