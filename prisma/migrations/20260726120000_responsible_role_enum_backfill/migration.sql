-- Pre-flight for 20260726130000_responsible_roles_array.
--
-- schema.prisma declares 9 ResponsibleRole values, but 0_init/migration.sql:5
-- only ever CREATE TYPE'd five of them ('COMMERCIAL','MARKETING','COORDINATOR',
-- 'FINANCIAL','FLEET_MANAGER') and no later migration adds the rest. The local
-- DB has all nine only because it was rebuilt from a backup after the
-- 2026-06-12 wipe -- production may still be missing OWNER, SELLER,
-- REPRESENTATIVE and DRIVER, which would make every write using them fail.
--
-- ADD VALUE IF NOT EXISTS is idempotent, so this is a no-op where the labels
-- already exist. It lives in its OWN migration on purpose: Postgres forbids
-- using a newly added enum label inside the same transaction that added it,
-- and the next migration casts the column to an array of this very type.

ALTER TYPE "RepresentativeRole" ADD VALUE IF NOT EXISTS 'COMMERCIAL';
ALTER TYPE "RepresentativeRole" ADD VALUE IF NOT EXISTS 'OWNER';
ALTER TYPE "RepresentativeRole" ADD VALUE IF NOT EXISTS 'SELLER';
ALTER TYPE "RepresentativeRole" ADD VALUE IF NOT EXISTS 'REPRESENTATIVE';
ALTER TYPE "RepresentativeRole" ADD VALUE IF NOT EXISTS 'COORDINATOR';
ALTER TYPE "RepresentativeRole" ADD VALUE IF NOT EXISTS 'MARKETING';
ALTER TYPE "RepresentativeRole" ADD VALUE IF NOT EXISTS 'FINANCIAL';
ALTER TYPE "RepresentativeRole" ADD VALUE IF NOT EXISTS 'FLEET_MANAGER';
ALTER TYPE "RepresentativeRole" ADD VALUE IF NOT EXISTS 'DRIVER';
