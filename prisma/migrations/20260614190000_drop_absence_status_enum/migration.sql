-- Drop the orphan AbsenceStatus enum. It was never referenced by any table
-- column or by application code (the Afastamento/Leave flow uses LeaveStatus,
-- and Secullum absences carry no Ankaa-side status enum). Confirmed zero usages
-- in src/ and prisma/schema.prisma before removal.
DROP TYPE IF EXISTS "AbsenceStatus";
