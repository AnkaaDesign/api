-- Add free-text "description" to Airbrushing (job spec/notes, e.g. "dragão na lateral direita").
-- descriptionNormalized is a lower(unaccent(...)) generated column for accent-insensitive search,
-- consistent with the other *Normalized columns (see 20260624150000_accent_insensitive_search).
-- No trigram index: Airbrushing is not one of the high-volume search tables, so it mirrors
-- ServiceOrder.descriptionNormalized, which is likewise un-indexed.

ALTER TABLE "Airbrushing"
  ADD COLUMN IF NOT EXISTS "description" text;

ALTER TABLE "Airbrushing"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;
