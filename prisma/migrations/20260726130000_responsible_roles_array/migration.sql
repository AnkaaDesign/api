-- Responsible (table "Representative"): a contact person at a customer company
-- can hold SEVERAL roles at once (e.g. OWNER + FINANCIAL), so employees know
-- which areas that contact actually handles.
--
--   role  "RepresentativeRole"     ->  roles  "RepresentativeRole"[]
--
-- Data-preserving: every existing row's single role becomes a 1-element array.
-- The ">= 1 role" rule is enforced in the Zod validation layer, not by a CHECK
-- constraint (this database has no CHECK constraints today -- no precedent).
--
-- Safe to run in place: pg_depend confirms the only object depending on
-- "Representative"."role" is the btree index "Representative_role_idx". The
-- three GENERATED ALWAYS columns (emailNormalized / nameNormalized /
-- phoneNormalized, added in 20260624150000_accent_insensitive_search) derive
-- from email/name/phone only, and the table has no triggers and no views.
--
-- NOTE: this migration is hand-written on purpose. `prisma migrate dev` would
-- emit DROP COLUMN "role" + ADD COLUMN "roles", silently destroying every
-- existing role assignment.

BEGIN;

-- DropIndex: a btree over an array cannot serve @> / && containment lookups.
DROP INDEX IF EXISTS "Representative_role_idx";

-- AlterTable: scalar enum -> enum array, preserving each row's value as a
-- 1-element array. NOT NULL carries over automatically through the type change.
ALTER TABLE "Representative"
  ALTER COLUMN "role" TYPE "RepresentativeRole"[] USING ARRAY["role"];

ALTER TABLE "Representative" RENAME COLUMN "role" TO "roles";

-- Match Prisma's `@default([])` and keep NOT NULL explicit.
ALTER TABLE "Representative"
  ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"RepresentativeRole"[];
ALTER TABLE "Representative"
  ALTER COLUMN "roles" SET NOT NULL;

-- CreateIndex: GIN so Prisma's has / hasSome / hasEvery (@> / &&) are indexed.
CREATE INDEX "Representative_roles_idx" ON "Representative" USING GIN ("roles");

COMMIT;
