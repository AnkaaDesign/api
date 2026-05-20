-- AlterTable: add optional per-sector appraiser override to AssessmentSector
ALTER TABLE "AssessmentSector" ADD COLUMN "appraiserId" TEXT;

-- CreateTable: explicit per-sector evaluatee list for each assessment
CREATE TABLE "AssessmentSectorEvaluatee" (
    "assessmentId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AssessmentSectorEvaluatee_pkey" PRIMARY KEY ("assessmentId","sectorId","userId")
);

-- CreateIndex
CREATE INDEX "AssessmentSectorEvaluatee_assessmentId_idx" ON "AssessmentSectorEvaluatee"("assessmentId");
CREATE INDEX "AssessmentSectorEvaluatee_sectorId_idx" ON "AssessmentSectorEvaluatee"("sectorId");
CREATE INDEX "AssessmentSectorEvaluatee_userId_idx" ON "AssessmentSectorEvaluatee"("userId");
CREATE INDEX "AssessmentSector_appraiserId_idx" ON "AssessmentSector"("appraiserId");

-- AddForeignKey
ALTER TABLE "AssessmentSector" ADD CONSTRAINT "AssessmentSector_appraiserId_fkey"
    FOREIGN KEY ("appraiserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssessmentSectorEvaluatee" ADD CONSTRAINT "AssessmentSectorEvaluatee_assessmentId_sectorId_fkey"
    FOREIGN KEY ("assessmentId", "sectorId") REFERENCES "AssessmentSector"("assessmentId", "sectorId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssessmentSectorEvaluatee" ADD CONSTRAINT "AssessmentSectorEvaluatee_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
