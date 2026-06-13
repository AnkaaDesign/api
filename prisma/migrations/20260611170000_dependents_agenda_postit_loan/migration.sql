-- Dependents (IRRF / salário-família), AgendaEvent + Postit (phase 2 modules),
-- PayrollDiscount loan installment tracking, new ChangeLogEntityType values.

-- AlterEnum
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'DEPENDENT';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'AGENDA_EVENT';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'POSTIT';

-- CreateEnum
CREATE TYPE "DependentRelationship" AS ENUM ('CHILD', 'STEPCHILD', 'SPOUSE', 'PARTNER', 'PARENT', 'WARD', 'DISABLED_ANY_AGE', 'OTHER');

-- AlterTable
ALTER TABLE "PayrollDiscount" ADD COLUMN     "currentInstallment" INTEGER,
ADD COLUMN     "totalInstallments" INTEGER;

-- CreateTable
CREATE TABLE "Dependent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "relationship" "DependentRelationship" NOT NULL,
    "irrfDeduction" BOOLEAN NOT NULL DEFAULT true,
    "salarioFamilia" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dependent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "notifyDaysBefore" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "notifyOnDay" BOOLEAN NOT NULL DEFAULT true,
    "channels" "NotificationChannel"[] DEFAULT ARRAY[]::"NotificationChannel"[],
    "targetSectorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Postit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'yellow',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Postit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dependent_userId_idx" ON "Dependent"("userId");

-- CreateIndex
CREATE INDEX "Dependent_relationship_idx" ON "Dependent"("relationship");

-- CreateIndex
CREATE INDEX "Dependent_irrfDeduction_idx" ON "Dependent"("irrfDeduction");

-- CreateIndex
CREATE INDEX "Dependent_salarioFamilia_idx" ON "Dependent"("salarioFamilia");

-- CreateIndex
CREATE UNIQUE INDEX "Dependent_userId_cpf_key" ON "Dependent"("userId", "cpf");

-- CreateIndex
CREATE INDEX "AgendaEvent_createdById_idx" ON "AgendaEvent"("createdById");

-- CreateIndex
CREATE INDEX "AgendaEvent_eventDate_idx" ON "AgendaEvent"("eventDate");

-- CreateIndex
CREATE INDEX "AgendaEvent_isActive_idx" ON "AgendaEvent"("isActive");

-- CreateIndex
CREATE INDEX "Postit_userId_idx" ON "Postit"("userId");

-- CreateIndex
CREATE INDEX "Postit_isArchived_idx" ON "Postit"("isArchived");

-- CreateIndex
CREATE INDEX "Postit_position_idx" ON "Postit"("position");

-- AddForeignKey
ALTER TABLE "Dependent" ADD CONSTRAINT "Dependent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaEvent" ADD CONSTRAINT "AgendaEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postit" ADD CONSTRAINT "Postit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
