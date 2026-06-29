-- Drop the redundant `User.isActive` column.
--
-- `isActive` was a legacy login gate that mirrored the contract situação
-- (`isActive = currentContractStatus != TERMINATED`). It is now fully derived:
-- login eligibility and every "active user" filter read `currentContractStatus`
-- (see isUserEmployed / EMPLOYED_USER_WHERE in src/utils/contract.ts). The
-- mirror is removed to eliminate the dual-write divergence hazard.

-- DropIndex
DROP INDEX IF EXISTS "User_isActive_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN IF EXISTS "isActive";
