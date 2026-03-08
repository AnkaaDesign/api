-- AlterTable
ALTER TABLE "NfseDocument" ADD COLUMN "chaveAcesso" TEXT;
ALTER TABLE "NfseDocument" ADD COLUMN "nDps" INTEGER;

-- CreateIndex
CREATE INDEX "NfseDocument_chaveAcesso_idx" ON "NfseDocument"("chaveAcesso");
