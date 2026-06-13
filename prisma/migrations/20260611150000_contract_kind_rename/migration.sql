-- ContractKind merge/rename (ACCOUNTING_AREA_CONTRACT.md AMENDMENT 2):
-- the user lifecycle enum UserStatus becomes ContractKind and gains two values.
-- No data rewrite: existing enum values keep their names.

-- Rename enum
ALTER TYPE "UserStatus" RENAME TO "ContractKind";

-- Rename columns (indexes follow the columns; names are fixed below)
ALTER TABLE "User" RENAME COLUMN "status" TO "contractKind";
ALTER TABLE "User" RENAME COLUMN "statusOrder" TO "contractKindOrder";

-- Rename indexes to Prisma-conventional names for the new columns
ALTER INDEX "User_statusOrder_idx" RENAME TO "User_contractKindOrder_idx";
ALTER INDEX "User_status_sectorId_idx" RENAME TO "User_contractKind_sectorId_idx";

-- New contract kinds
ALTER TYPE "ContractKind" ADD VALUE IF NOT EXISTS 'APPRENTICE';
ALTER TYPE "ContractKind" ADD VALUE IF NOT EXISTS 'INTERMITTENT';
