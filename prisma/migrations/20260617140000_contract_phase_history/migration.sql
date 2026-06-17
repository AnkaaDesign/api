-- ContractPhaseHistory: auditable timeline of the modalities (contractType) an
-- EmploymentContract held over its life. The contract advances its MODALITY in
-- place (EXPERIENCE_PERIOD_1 -> EXPERIENCE_PERIOD_2 -> INDETERMINATE) without
-- termination/recreation; each row records one phase (startDate..endDate, NULL
-- endDate = current/open phase). At most one open row per contract.

-- CreateTable
CREATE TABLE "ContractPhaseHistory" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "contractId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractType" "ContractType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "triggeredBy" "ChangeLogTriggeredByType",
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractPhaseHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractPhaseHistory_contractId_endDate_idx" ON "ContractPhaseHistory"("contractId", "endDate");

-- CreateIndex
CREATE INDEX "ContractPhaseHistory_userId_idx" ON "ContractPhaseHistory"("userId");

-- AddForeignKey
ALTER TABLE "ContractPhaseHistory" ADD CONSTRAINT "ContractPhaseHistory_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractPhaseHistory" ADD CONSTRAINT "ContractPhaseHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- BACKFILL: reconstruct a best-effort phase timeline from the contract's date
-- fields. The enum has no MIGRATION value, so backfilled rows are tagged
-- triggeredBy='SYSTEM' with reason 'Backfill (migração do histórico de fases)'.
-- Strategy per contract (contractType IS NOT NULL only):
--   * Emit a CLOSED EXPERIENCE_PERIOD_1 row when phase-1 is in the PAST relative
--     to the current modality (i.e. current modality is EXPERIENCE_PERIOD_2 or a
--     post-experience modality) and phase-1 dates exist.
--   * Emit a CLOSED EXPERIENCE_PERIOD_2 row when the current modality is a
--     post-experience modality and phase-2 dates exist.
--   * Always emit the FINAL/current modality row: start = COALESCE(effectedAt,
--     exp2EndAt, exp1EndAt, admissionDate, createdAt); end = terminationDate (or
--     updatedAt) when status='TERMINATED', else NULL (open).
-- Duplicate guard: when the current modality IS EXPERIENCE_PERIOD_1 we only emit
-- the single (open/closed) phase-1 row — never also a closed phase-1.
-- ============================================================================

-- 1) Closed EXPERIENCE_PERIOD_1 rows (only when phase-1 is historical: the
--    contract has already advanced beyond phase 1). Skipped when the current
--    modality is still EXPERIENCE_PERIOD_1 (that case is covered by the final row).
INSERT INTO "ContractPhaseHistory" ("id", "contractId", "userId", "contractType", "startDate", "endDate", "triggeredBy", "reason", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    ec."id",
    ec."userId",
    'EXPERIENCE_PERIOD_1'::"ContractType",
    COALESCE(ec."exp1StartAt", ec."admissionDate", ec."createdAt"),
    ec."exp1EndAt",
    'SYSTEM'::"ChangeLogTriggeredByType",
    'Backfill (migração do histórico de fases)',
    now(),
    now()
FROM "EmploymentContract" ec
WHERE ec."contractType" IS NOT NULL
  AND ec."contractType" <> 'EXPERIENCE_PERIOD_1'
  AND (ec."exp1StartAt" IS NOT NULL OR ec."exp1EndAt" IS NOT NULL);

-- 2) Closed EXPERIENCE_PERIOD_2 rows (only when phase-2 is historical: the
--    contract has advanced past experience entirely). Skipped when the current
--    modality is itself an experience phase.
INSERT INTO "ContractPhaseHistory" ("id", "contractId", "userId", "contractType", "startDate", "endDate", "triggeredBy", "reason", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    ec."id",
    ec."userId",
    'EXPERIENCE_PERIOD_2'::"ContractType",
    COALESCE(ec."exp2StartAt", ec."exp1EndAt", ec."admissionDate", ec."createdAt"),
    ec."exp2EndAt",
    'SYSTEM'::"ChangeLogTriggeredByType",
    'Backfill (migração do histórico de fases)',
    now(),
    now()
FROM "EmploymentContract" ec
WHERE ec."contractType" IS NOT NULL
  AND ec."contractType" NOT IN ('EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2')
  AND (ec."exp2StartAt" IS NOT NULL OR ec."exp2EndAt" IS NOT NULL);

-- 3) Final/current modality row. endDate set (closed) only for TERMINATED
--    contracts; otherwise NULL (open/current phase). This is the single row when
--    full reconstruction is ambiguous (the fallback path).
INSERT INTO "ContractPhaseHistory" ("id", "contractId", "userId", "contractType", "startDate", "endDate", "triggeredBy", "reason", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    ec."id",
    ec."userId",
    ec."contractType",
    COALESCE(ec."effectedAt", ec."exp2EndAt", ec."exp1EndAt", ec."admissionDate", ec."createdAt"),
    CASE WHEN ec."status" = 'TERMINATED' THEN COALESCE(ec."terminationDate", ec."updatedAt") ELSE NULL END,
    'SYSTEM'::"ChangeLogTriggeredByType",
    'Backfill (migração do histórico de fases)',
    now(),
    now()
FROM "EmploymentContract" ec
WHERE ec."contractType" IS NOT NULL;
