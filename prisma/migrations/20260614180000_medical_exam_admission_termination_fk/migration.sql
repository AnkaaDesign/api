-- Link MedicalExam to the employment-lifecycle event that requires it
-- (admissional ↔ Admission, demissional ↔ Termination), replacing the fragile
-- userId+type heuristic. Optional, unique (one exam per event), SET NULL on delete.

-- AlterTable
ALTER TABLE "MedicalExam" ADD COLUMN     "admissionId" TEXT,
ADD COLUMN     "terminationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MedicalExam_admissionId_key" ON "MedicalExam"("admissionId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalExam_terminationId_key" ON "MedicalExam"("terminationId");

-- CreateIndex
CREATE INDEX "MedicalExam_admissionId_idx" ON "MedicalExam"("admissionId");

-- CreateIndex
CREATE INDEX "MedicalExam_terminationId_idx" ON "MedicalExam"("terminationId");

-- AddForeignKey
ALTER TABLE "MedicalExam" ADD CONSTRAINT "MedicalExam_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalExam" ADD CONSTRAINT "MedicalExam_terminationId_fkey" FOREIGN KEY ("terminationId") REFERENCES "Termination"("id") ON DELETE SET NULL ON UPDATE CASCADE;
