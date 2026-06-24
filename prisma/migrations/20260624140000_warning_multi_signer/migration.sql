-- Support multiple signers per warning: the collaborator AND each indicated witness
-- (testemunhas) sign/acknowledge in their own app. One row per (warning, signer).

-- CreateEnum
CREATE TYPE "WarningSignerRole" AS ENUM ('COLLABORATOR', 'WITNESS');

-- AlterTable
ALTER TABLE "WarningSignature" ADD COLUMN "signerRole" "WarningSignerRole" NOT NULL DEFAULT 'COLLABORATOR';

-- DropIndex (one-signature-per-warning constraint no longer holds)
DROP INDEX "WarningSignature_warningId_key";

-- CreateIndex (one signature per signer per warning)
CREATE UNIQUE INDEX "WarningSignature_warningId_signedByUserId_key" ON "WarningSignature"("warningId", "signedByUserId");
