-- Corrective migration for two artifacts left by the contract binary-status /
-- experience-as-type remodel (20260617120000) and the phase-history backfill
-- (20260617140000). Hand-written; apply with `prisma migrate deploy`.
--
-- BUG 1 — stale User cache (the "Situação" badge showed "Em experiência 1" while
-- the contract was already EXPERIENCE_PERIOD_2). The 20260617120000 migration could
-- not derive the experience phase for the User cache (the cache has no phase column),
-- so it placed every experience user's currentContractType at EXPERIENCE_PERIOD_1 as a
-- PLACEHOLDER and deferred the recompute to a resync job. This IS that resync job:
-- recompute the cache from the canonical current EmploymentContract (source of truth).
--
-- BUG 2 — ContractPhaseHistory open-phase start dates. The backfill used
-- COALESCE(effectedAt, exp2EndAt, exp1EndAt, ...) for the current/open phase row, which
-- wrongly picked the (future) effectedAt as the start of a current EXPERIENCE_PERIOD_1/2
-- phase. The start of an open phase must come from the phase's own start date.

BEGIN;

-- 1. Resync the User vínculo cache from the canonical current EmploymentContract.
UPDATE "User" u
SET "currentContractType"   = ec."contractType",
    "currentContractStatus" = ec."status",
    "currentEmployeeType"   = ec."employeeType",
    "isActive"              = (ec."status" <> 'TERMINATED')
FROM "EmploymentContract" ec
WHERE u."currentContractId" = ec."id"
  AND (
        u."currentContractType"   IS DISTINCT FROM ec."contractType"
     OR u."currentContractStatus" IS DISTINCT FROM ec."status"
     OR u."currentEmployeeType"   IS DISTINCT FROM ec."employeeType"
     OR u."isActive"              IS DISTINCT FROM (ec."status" <> 'TERMINATED')
      );

-- 2. Fix open (current) phase-history start dates to come from the phase's own start,
--    per modality. Closed rows (endDate not null) were backfilled correctly.
UPDATE "ContractPhaseHistory" cph
SET "startDate" = CASE cph."contractType"
      WHEN 'EXPERIENCE_PERIOD_1' THEN COALESCE(ec."exp1StartAt", ec."admissionDate", ec."createdAt")
      WHEN 'EXPERIENCE_PERIOD_2' THEN COALESCE(ec."exp2StartAt", ec."exp1EndAt", ec."admissionDate", ec."createdAt")
      WHEN 'INDETERMINATE'       THEN COALESCE(ec."effectedAt", ec."exp2EndAt", ec."exp1EndAt", ec."admissionDate", ec."createdAt")
      ELSE cph."startDate"
    END
FROM "EmploymentContract" ec
WHERE cph."contractId" = ec."id"
  AND cph."endDate" IS NULL
  AND cph."contractType" IN ('EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2', 'INDETERMINATE');

COMMIT;
