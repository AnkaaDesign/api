-- CreateTable
CREATE TABLE "TaskForecastHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "previousDate" TIMESTAMP(3),
    "newDate" TIMESTAMP(3),
    "reason" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskForecastHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskForecastHistory_taskId_idx" ON "TaskForecastHistory"("taskId");

-- CreateIndex
CREATE INDEX "TaskForecastHistory_createdAt_idx" ON "TaskForecastHistory"("createdAt");

-- CreateIndex
CREATE INDEX "TaskForecastHistory_taskId_createdAt_idx" ON "TaskForecastHistory"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskForecastHistory" ADD CONSTRAINT "TaskForecastHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskForecastHistory" ADD CONSTRAINT "TaskForecastHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
