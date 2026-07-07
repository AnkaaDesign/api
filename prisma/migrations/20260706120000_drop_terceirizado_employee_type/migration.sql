-- Drop the TERCEIRIZADO employee category entirely. Existing off-folha
-- TERCEIRIZADO vínculos are migrated to PJ (Pessoa Jurídica), the sole remaining
-- provider category. Both columns that use the EmployeeType enum are updated:
-- User.currentEmployeeType (cache) and EmploymentContract.employeeType (source).

-- 1) Migrate existing data off TERCEIRIZADO before the value is removed.
UPDATE "User" SET "currentEmployeeType" = 'PJ' WHERE "currentEmployeeType" = 'TERCEIRIZADO';
UPDATE "EmploymentContract" SET "employeeType" = 'PJ' WHERE "employeeType" = 'TERCEIRIZADO';

-- 2) Recreate the EmployeeType enum without TERCEIRIZADO. Postgres cannot drop an
-- enum value in place, so swap the type: rename old -> create new -> recast
-- columns -> drop old.
ALTER TYPE "EmployeeType" RENAME TO "EmployeeType_old";
CREATE TYPE "EmployeeType" AS ENUM ('CLT', 'INTERN', 'PJ', 'AUTONOMOUS');

ALTER TABLE "User" ALTER COLUMN "currentEmployeeType" DROP DEFAULT;
ALTER TABLE "EmploymentContract" ALTER COLUMN "employeeType" DROP DEFAULT;

ALTER TABLE "User"
  ALTER COLUMN "currentEmployeeType" TYPE "EmployeeType"
  USING ("currentEmployeeType"::text::"EmployeeType");
ALTER TABLE "EmploymentContract"
  ALTER COLUMN "employeeType" TYPE "EmployeeType"
  USING ("employeeType"::text::"EmployeeType");

ALTER TABLE "User" ALTER COLUMN "currentEmployeeType" SET DEFAULT 'CLT';
ALTER TABLE "EmploymentContract" ALTER COLUMN "employeeType" SET DEFAULT 'CLT';

DROP TYPE "EmployeeType_old";
