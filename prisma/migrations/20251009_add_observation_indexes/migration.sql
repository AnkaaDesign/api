-- CreateIndex
CREATE INDEX IF NOT EXISTS "Observation_taskId_idx" ON "Observation"("taskId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Observation_createdAt_idx" ON "Observation"("createdAt");
