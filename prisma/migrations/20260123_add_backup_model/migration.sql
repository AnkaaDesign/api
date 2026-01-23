-- CreateEnum (required by BackupSchedule and Backup)
CREATE TYPE "BackupType" AS ENUM ('DATABASE', 'FILES', 'SYSTEM', 'FULL');

-- CreateEnum (required by BackupSchedule and Backup)
CREATE TYPE "BackupPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum (required by BackupSchedule)
CREATE TYPE "BackupScheduleStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GDriveSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'DELETED');

-- CreateTable (BackupSchedule must be created before Backup due to foreign key)
CREATE TABLE "BackupSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BackupType" NOT NULL,
    "description" TEXT,
    "paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cronExpression" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" "BackupPriority" NOT NULL DEFAULT 'MEDIUM',
    "compressionLevel" INTEGER NOT NULL DEFAULT 6,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "autoDeleteEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoDeleteRetention" TEXT,
    "bullJobId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" "BackupScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "BackupSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackupSchedule_bullJobId_key" ON "BackupSchedule"("bullJobId");

-- CreateIndex
CREATE INDEX "BackupSchedule_type_idx" ON "BackupSchedule"("type");

-- CreateIndex
CREATE INDEX "BackupSchedule_enabled_idx" ON "BackupSchedule"("enabled");

-- CreateIndex
CREATE INDEX "BackupSchedule_nextRunAt_idx" ON "BackupSchedule"("nextRunAt");

-- CreateIndex
CREATE INDEX "BackupSchedule_createdById_idx" ON "BackupSchedule"("createdById");

-- CreateIndex
CREATE INDEX "BackupSchedule_deletedAt_idx" ON "BackupSchedule"("deletedAt");

-- AddForeignKey
ALTER TABLE "BackupSchedule" ADD CONSTRAINT "BackupSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupSchedule" ADD CONSTRAINT "BackupSchedule_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BackupType" NOT NULL,
    "description" TEXT,
    "paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "BackupPriority" NOT NULL DEFAULT 'MEDIUM',
    "compressionLevel" INTEGER NOT NULL DEFAULT 6,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "size" BIGINT NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "autoDeleteEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoDeleteRetention" TEXT,
    "autoDeleteAfter" TIMESTAMP(3),
    "filePath" TEXT,
    "gdriveFileId" TEXT,
    "gdriveStatus" "GDriveSyncStatus" NOT NULL DEFAULT 'PENDING',
    "gdriveSyncedAt" TIMESTAMP(3),
    "scheduleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Backup_status_idx" ON "Backup"("status");

-- CreateIndex
CREATE INDEX "Backup_type_idx" ON "Backup"("type");

-- CreateIndex
CREATE INDEX "Backup_createdAt_idx" ON "Backup"("createdAt");

-- CreateIndex
CREATE INDEX "Backup_autoDeleteAfter_idx" ON "Backup"("autoDeleteAfter");

-- CreateIndex
CREATE INDEX "Backup_scheduleId_idx" ON "Backup"("scheduleId");

-- CreateIndex
CREATE INDEX "Backup_createdById_idx" ON "Backup"("createdById");

-- CreateIndex
CREATE INDEX "Backup_deletedAt_idx" ON "Backup"("deletedAt");

-- CreateIndex
CREATE INDEX "Backup_gdriveStatus_idx" ON "Backup"("gdriveStatus");

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "BackupSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
