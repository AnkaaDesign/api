-- Drop BankStatement and denormalize its bank-account columns onto
-- BankTransaction. The new natural-key dedup is (bankCode, agency,
-- accountNumber, fitId) — re-importing the same OFX is a no-op.

-- 1. Add the new columns to BankTransaction (nullable so the backfill can run).
ALTER TABLE "BankTransaction"
    ADD COLUMN "bankCode"      TEXT,
    ADD COLUMN "bankName"      TEXT,
    ADD COLUMN "agency"        TEXT,
    ADD COLUMN "accountNumber" TEXT,
    ADD COLUMN "ownerCnpj"     TEXT,
    ADD COLUMN "rawFileId"     TEXT,
    ADD COLUMN "uploadedById"  TEXT,
    ADD COLUMN "importedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2. Backfill the new columns from the joined BankStatement row.
UPDATE "BankTransaction" t SET
    "bankCode"      = s."bankCode",
    "bankName"      = s."bankName",
    "agency"        = s."agency",
    "accountNumber" = s."accountNumber",
    "ownerCnpj"     = s."ownerCnpj",
    "rawFileId"     = s."rawFileId",
    "uploadedById"  = s."uploadedById",
    "importedAt"    = s."importedAt"
FROM "BankStatement" s
WHERE t."statementId" = s.id;

-- 3. Enforce NOT NULL on the columns that are required going forward.
ALTER TABLE "BankTransaction"
    ALTER COLUMN "bankCode"      SET NOT NULL,
    ALTER COLUMN "bankName"      SET NOT NULL,
    ALTER COLUMN "agency"        SET NOT NULL,
    ALTER COLUMN "accountNumber" SET NOT NULL;

-- 4. Drop the old unique index + FK + statementId column.
DROP INDEX IF EXISTS "BankTransaction_statementId_fitId_key";

ALTER TABLE "BankTransaction" DROP CONSTRAINT IF EXISTS "BankTransaction_statementId_fkey";
ALTER TABLE "BankTransaction" DROP COLUMN "statementId";

-- 5. New unique index on the natural OFX dedup key.
CREATE UNIQUE INDEX "BankTransaction_bankCode_agency_accountNumber_fitId_key"
    ON "BankTransaction"("bankCode", "agency", "accountNumber", "fitId");

CREATE INDEX "BankTransaction_bankCode_accountNumber_postedAt_idx"
    ON "BankTransaction"("bankCode", "accountNumber", "postedAt");

-- 6. Hook the audit FKs to the now-relocated columns on BankTransaction.
ALTER TABLE "BankTransaction"
    ADD CONSTRAINT "BankTransaction_rawFileId_fkey"
    FOREIGN KEY ("rawFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankTransaction"
    ADD CONSTRAINT "BankTransaction_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Drop statementId from ReconciliationRun (now meaningless).
ALTER TABLE "ReconciliationRun" DROP COLUMN IF EXISTS "statementId";

-- 8. Drop BankStatement itself.
DROP TABLE "BankStatement";

-- 9. Drop the now-unused enums.
DROP TYPE "BankStatementImportStatus";
DROP TYPE "BankStatementSource";
