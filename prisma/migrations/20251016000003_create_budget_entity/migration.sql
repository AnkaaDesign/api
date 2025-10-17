-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Budget_taskId_idx" ON "Budget"("taskId");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
