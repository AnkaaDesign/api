-- ============================================================================
-- Vacation FLAT model + collective-unification
-- ============================================================================
-- Uma Vacation deixa de ser "um direito com um VacationPeriod[] de fracionamento"
-- e passa a ser UMA tomada single-period (startDate + days). Várias Vacations
-- podem compartilhar o mesmo período aquisitivo (irmãs); o saldo de gozo é
-- derivado agrupando as irmãs por (userId, acquisitiveStart, acquisitiveEnd).
--
-- Hand-written para `migrate deploy` (o shadow DB de `migrate dev` está quebrado).
-- ============================================================================

-- 1) Novas colunas em Vacation (default 0 para preencher linhas existentes).
ALTER TABLE "Vacation" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Vacation" ADD COLUMN "days" INTEGER NOT NULL DEFAULT 0;

-- 2) Novas colunas em VacationGroup (template single-period).
ALTER TABLE "VacationGroup" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "VacationGroup" ADD COLUMN "days" INTEGER NOT NULL DEFAULT 0;

-- ============================================================================
-- 3) Backfill Vacation a partir dos VacationPeriod existentes.
-- ============================================================================

-- 3a) Período[0] (o mais antigo por startDate) -> Vacation.startDate/days.
WITH first_period AS (
  SELECT DISTINCT ON ("vacationId") "vacationId", "startDate", "days"
  FROM "VacationPeriod"
  ORDER BY "vacationId", "startDate" ASC, "createdAt" ASC
)
UPDATE "Vacation" v
SET "startDate" = fp."startDate",
    "days"      = fp."days"
FROM first_period fp
WHERE v."id" = fp."vacationId";

-- 3b) Vacations SEM nenhum período: startDate = NULL,
--     days = max(0, entitledDays - abonoPecuniarioDays).
UPDATE "Vacation" v
SET "days" = GREATEST(0, v."entitledDays" - v."abonoPecuniarioDays")
WHERE NOT EXISTS (SELECT 1 FROM "VacationPeriod" p WHERE p."vacationId" = v."id");

-- 3c) Períodos[1..n] (todos exceto o primeiro) -> NOVAS Vacations irmãs,
--     copiando os campos de direito do registro pai. abonoPecuniarioDays = 0
--     (somente a primeira tomada carrega abono). status copiado do pai.
WITH ranked AS (
  SELECT p."id"          AS period_id,
         p."vacationId"  AS vacation_id,
         p."startDate"   AS p_start,
         p."days"        AS p_days,
         ROW_NUMBER() OVER (
           PARTITION BY p."vacationId"
           ORDER BY p."startDate" ASC, p."createdAt" ASC
         ) AS rn
  FROM "VacationPeriod" p
)
INSERT INTO "Vacation" (
  "id", "userId", "contractId", "groupId",
  "startDate", "days",
  "acquisitiveStart", "acquisitiveEnd", "concessiveEnd",
  "unjustifiedAbsencesInPeriod", "entitledDays",
  "status", "statusOrder",
  "abonoPecuniarioDays", "soldThird",
  "baseRemuneration", "oneThird", "abonoAmount", "inss", "irrf",
  "isDouble", "paymentDueDate", "paymentDate", "notes",
  "deletedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  v."userId", v."contractId", v."groupId",
  r.p_start, r.p_days,
  v."acquisitiveStart", v."acquisitiveEnd", v."concessiveEnd",
  v."unjustifiedAbsencesInPeriod", v."entitledDays",
  v."status", v."statusOrder",
  0, v."soldThird",
  NULL, NULL, NULL, NULL, NULL,
  v."isDouble", v."paymentDueDate", v."paymentDate", v."notes",
  v."deletedAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM ranked r
JOIN "Vacation" v ON v."id" = r.vacation_id
WHERE r.rn > 1;

-- ============================================================================
-- 4) Backfill VacationGroup a partir do VacationGroupPeriod[0].
-- ============================================================================
WITH first_group_period AS (
  SELECT DISTINCT ON ("groupId") "groupId", "startDate", "days"
  FROM "VacationGroupPeriod"
  ORDER BY "groupId", "startDate" ASC, "createdAt" ASC
)
UPDATE "VacationGroup" g
SET "startDate" = fgp."startDate",
    "days"      = fgp."days"
FROM first_group_period fgp
WHERE g."id" = fgp."groupId";

-- ============================================================================
-- 5) Drop do índice único parcial (múltiplas Vacations por período agora OK).
-- ============================================================================
DROP INDEX IF EXISTS "Vacation_userId_acquisitive_unique";

-- ============================================================================
-- 6) Novos índices de suporte ao modelo FLAT.
-- ============================================================================
CREATE INDEX "Vacation_startDate_idx" ON "Vacation" ("startDate");
CREATE INDEX "Vacation_userId_acquisitiveStart_acquisitiveEnd_idx"
  ON "Vacation" ("userId", "acquisitiveStart", "acquisitiveEnd");

-- ============================================================================
-- 7) Drop das tabelas de períodos (APÓS o backfill).
-- ============================================================================
DROP TABLE IF EXISTS "VacationPeriod";
DROP TABLE IF EXISTS "VacationGroupPeriod";
