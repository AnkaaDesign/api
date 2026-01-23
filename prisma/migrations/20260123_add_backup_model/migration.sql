-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GDriveSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'DELETED');

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
