-- PHASE 1: ContractType add EXPERIENCE_PERIOD_1/2 + backfill experience phase into type
BEGIN;
CREATE TYPE "ContractType_new" AS ENUM ('INDETERMINATE','FIXED_TERM','INTERMITTENT','APPRENTICE','TEMPORARY','EXPERIENCE_PERIOD_1','EXPERIENCE_PERIOD_2');
ALTER TABLE "EmploymentContract" ALTER COLUMN "contractType" TYPE "ContractType_new" USING (
  CASE
    WHEN "status"::text='EXPERIENCE' AND "employeeType"::text='CLT' THEN
      CASE WHEN "experiencePhase"=2 THEN 'EXPERIENCE_PERIOD_2'
           WHEN "experiencePhase"=1 THEN 'EXPERIENCE_PERIOD_1'
           WHEN "exp2StartAt" IS NOT NULL THEN 'EXPERIENCE_PERIOD_2'
           ELSE 'EXPERIENCE_PERIOD_1' END
    WHEN "contractType" IS NULL THEN NULL
    ELSE "contractType"::text END)::"ContractType_new";
ALTER TABLE "User" ALTER COLUMN "currentContractType" TYPE "ContractType_new" USING (
  CASE WHEN "currentContractStatus"::text='EXPERIENCE' AND "currentEmployeeType"::text='CLT' THEN 'EXPERIENCE_PERIOD_1'
       WHEN "currentContractType" IS NULL THEN NULL
       ELSE "currentContractType"::text END)::"ContractType_new";
ALTER TYPE "ContractType" RENAME TO "ContractType_old";
ALTER TYPE "ContractType_new" RENAME TO "ContractType";
DROP TYPE "ContractType_old";
COMMIT;

-- PHASE 2: ContractStatus -> binary {ACTIVE,TERMINATED}
BEGIN;
CREATE TYPE "ContractStatus_new" AS ENUM ('ACTIVE','TERMINATED');
ALTER TABLE "EmploymentContract" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "currentContractStatus" DROP DEFAULT;
ALTER TABLE "EmploymentContract" ALTER COLUMN "status" TYPE "ContractStatus_new" USING (CASE WHEN "status"::text='TERMINATED' THEN 'TERMINATED' ELSE 'ACTIVE' END)::"ContractStatus_new";
ALTER TABLE "User" ALTER COLUMN "currentContractStatus" TYPE "ContractStatus_new" USING (CASE WHEN "currentContractStatus" IS NULL THEN NULL WHEN "currentContractStatus"::text='TERMINATED' THEN 'TERMINATED' ELSE 'ACTIVE' END)::"ContractStatus_new";
ALTER TYPE "ContractStatus" RENAME TO "ContractStatus_old";
ALTER TYPE "ContractStatus_new" RENAME TO "ContractStatus";
DROP TYPE "ContractStatus_old";
ALTER TABLE "EmploymentContract" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "User" ALTER COLUMN "currentContractStatus" SET DEFAULT 'ACTIVE';
COMMIT;

-- PHASE 3: drop experiencePhase (nullable Int, safe)
BEGIN;
ALTER TABLE "EmploymentContract" DROP COLUMN IF EXISTS "experiencePhase";
COMMIT;
