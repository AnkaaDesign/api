-- Billed installations inside one recurring bill (SAMAE matrícula, COPEL UC).
-- See the model doc in schema.prisma for why this exists.

CREATE TABLE "RecurrentPayableInstallation" (
    "id" TEXT NOT NULL,
    "recurrentPayableId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "estimatedAmount" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurrentPayableInstallation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecurrentPayableInstallation_recurrentPayableId_code_key"
    ON "RecurrentPayableInstallation"("recurrentPayableId", "code");
CREATE INDEX "RecurrentPayableInstallation_recurrentPayableId_idx"
    ON "RecurrentPayableInstallation"("recurrentPayableId");
CREATE INDEX "RecurrentPayableInstallation_isActive_idx"
    ON "RecurrentPayableInstallation"("isActive");

ALTER TABLE "RecurrentPayableInstallation"
    ADD CONSTRAINT "RecurrentPayableInstallation_recurrentPayableId_fkey"
    FOREIGN KEY ("recurrentPayableId") REFERENCES "RecurrentPayable"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Occurrences gain the installation discriminator. Existing rows keep
-- installationKey = '' , which makes the new unique exactly equivalent to the
-- old (payableId, dueDate) one for every row already in the table.
ALTER TABLE "RecurrentPayableOccurrence" ADD COLUMN "installationId" TEXT;
ALTER TABLE "RecurrentPayableOccurrence" ADD COLUMN "installationKey" TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "RecurrentPayableOccurrence_recurrentPayableId_dueDate_key";

CREATE UNIQUE INDEX "RecurrentPayableOccurrence_recurrentPayableId_dueDate_insta_key"
    ON "RecurrentPayableOccurrence"("recurrentPayableId", "dueDate", "installationKey");
CREATE INDEX "RecurrentPayableOccurrence_installationId_idx"
    ON "RecurrentPayableOccurrence"("installationId");

ALTER TABLE "RecurrentPayableOccurrence"
    ADD CONSTRAINT "RecurrentPayableOccurrence_installationId_fkey"
    FOREIGN KEY ("installationId") REFERENCES "RecurrentPayableInstallation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
