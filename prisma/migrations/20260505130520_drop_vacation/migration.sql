-- Drop Vacation model + associated enums.
-- Vacation tracking moved to Secullum (FuncionariosAfastamentos endpoint);
-- the local Vacation table and its enums are no longer maintained.

-- Drop the Vacation table (cascades through its FK to User via ON DELETE SET NULL semantics
-- already configured by Prisma; safe under the current relation definition).
DROP TABLE IF EXISTS "Vacation";

-- Drop the now-orphaned enum types. Postgres won't allow dropping an enum that's
-- still referenced; the table drop above removes the only references.
DROP TYPE IF EXISTS "VacationStatus";
DROP TYPE IF EXISTS "VacationType";
