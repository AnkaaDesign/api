-- ============================================================
-- Skill Assessment Rewrite
-- ============================================================
-- Drops the legacy SkillModel / SkillCategory / SkillIndicator /
-- SkillIndicatorScore / SkillAssessment / SkillAssessmentResponse /
-- SkillAssessmentPeriod surface and replaces it with the new
-- Skill / Topic / TopicLevel / Assessment / AssessmentEntry /
-- AssessmentResponse domain (plus AssessmentSector / AssessmentSkill /
-- AssessmentTopic M:N joins).
--
-- This is a DESTRUCTIVE migration: existing rows in the legacy
-- tables will be dropped. The api/src/modules/skill/skill-seed.service
-- repopulates the catalogue (3 Skills + 17 Topics + 102 TopicLevels)
-- on next NestJS boot via onModuleInit.
-- ============================================================

-- Drop legacy tables (children first to satisfy FK constraints)
DROP TABLE IF EXISTS "SkillAssessmentResponse" CASCADE;
DROP TABLE IF EXISTS "SkillAssessment" CASCADE;
DROP TABLE IF EXISTS "SkillAssessmentPeriod" CASCADE;
DROP TABLE IF EXISTS "SkillIndicatorScore" CASCADE;
DROP TABLE IF EXISTS "SkillIndicator" CASCADE;
DROP TABLE IF EXISTS "SkillCategory" CASCADE;
DROP TABLE IF EXISTS "SkillModel" CASCADE;

-- Drop legacy enums
DROP TYPE IF EXISTS "SkillAssessmentStatus";
DROP TYPE IF EXISTS "SkillAssessmentPeriodStatus";


-- CreateEnum
CREATE TYPE "SkillArea" AS ENUM ('BEHAVIORAL', 'SAFETY', 'PRODUCTIVITY');


-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');


-- CreateEnum
CREATE TYPE "AssessmentEntryStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUBMITTED');


-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "area" "SkillArea" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "counterBehaviors" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "TopicLevel" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicLevel_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "AssessmentSector" (
    "assessmentId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "AssessmentSector_pkey" PRIMARY KEY ("assessmentId","sectorId")
);


-- CreateTable
CREATE TABLE "AssessmentSkill" (
    "assessmentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "AssessmentSkill_pkey" PRIMARY KEY ("assessmentId","skillId")
);


-- CreateTable
CREATE TABLE "AssessmentTopic" (
    "assessmentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "AssessmentTopic_pkey" PRIMARY KEY ("assessmentId","topicId")
);


-- CreateTable
CREATE TABLE "AssessmentEntry" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "evaluateeId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "status" "AssessmentEntryStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentEntry_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "AssessmentResponse" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "justification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentResponse_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");


-- CreateIndex
CREATE INDEX "Skill_area_order_idx" ON "Skill"("area", "order");


-- CreateIndex
CREATE INDEX "Skill_isActive_idx" ON "Skill"("isActive");


-- CreateIndex
CREATE INDEX "Skill_deletedAt_idx" ON "Skill"("deletedAt");


-- CreateIndex
CREATE INDEX "Topic_skillId_idx" ON "Topic"("skillId");


-- CreateIndex
CREATE INDEX "Topic_deletedAt_idx" ON "Topic"("deletedAt");


-- CreateIndex
CREATE UNIQUE INDEX "Topic_skillId_order_key" ON "Topic"("skillId", "order");


-- CreateIndex
CREATE INDEX "TopicLevel_topicId_idx" ON "TopicLevel"("topicId");


-- CreateIndex
CREATE UNIQUE INDEX "TopicLevel_topicId_score_key" ON "TopicLevel"("topicId", "score");


-- CreateIndex
CREATE INDEX "Assessment_status_idx" ON "Assessment"("status");


-- CreateIndex
CREATE INDEX "Assessment_periodStart_periodEnd_idx" ON "Assessment"("periodStart", "periodEnd");


-- CreateIndex
CREATE INDEX "Assessment_createdById_idx" ON "Assessment"("createdById");


-- CreateIndex
CREATE INDEX "Assessment_deletedAt_idx" ON "Assessment"("deletedAt");


-- CreateIndex
CREATE INDEX "AssessmentSector_assessmentId_idx" ON "AssessmentSector"("assessmentId");


-- CreateIndex
CREATE INDEX "AssessmentSector_sectorId_idx" ON "AssessmentSector"("sectorId");


-- CreateIndex
CREATE INDEX "AssessmentSkill_assessmentId_idx" ON "AssessmentSkill"("assessmentId");


-- CreateIndex
CREATE INDEX "AssessmentSkill_skillId_idx" ON "AssessmentSkill"("skillId");


-- CreateIndex
CREATE INDEX "AssessmentTopic_assessmentId_idx" ON "AssessmentTopic"("assessmentId");


-- CreateIndex
CREATE INDEX "AssessmentTopic_topicId_idx" ON "AssessmentTopic"("topicId");


-- CreateIndex
CREATE INDEX "AssessmentEntry_assessmentId_idx" ON "AssessmentEntry"("assessmentId");


-- CreateIndex
CREATE INDEX "AssessmentEntry_evaluateeId_idx" ON "AssessmentEntry"("evaluateeId");


-- CreateIndex
CREATE INDEX "AssessmentEntry_evaluatorId_idx" ON "AssessmentEntry"("evaluatorId");


-- CreateIndex
CREATE INDEX "AssessmentEntry_status_idx" ON "AssessmentEntry"("status");


-- CreateIndex
CREATE INDEX "AssessmentEntry_deletedAt_idx" ON "AssessmentEntry"("deletedAt");


-- CreateIndex
CREATE UNIQUE INDEX "AssessmentEntry_assessmentId_evaluateeId_key" ON "AssessmentEntry"("assessmentId", "evaluateeId");


-- CreateIndex
CREATE INDEX "AssessmentResponse_entryId_idx" ON "AssessmentResponse"("entryId");


-- CreateIndex
CREATE INDEX "AssessmentResponse_topicId_idx" ON "AssessmentResponse"("topicId");


-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResponse_entryId_topicId_key" ON "AssessmentResponse"("entryId", "topicId");


-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "TopicLevel" ADD CONSTRAINT "TopicLevel_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentSector" ADD CONSTRAINT "AssessmentSector_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentSector" ADD CONSTRAINT "AssessmentSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentSkill" ADD CONSTRAINT "AssessmentSkill_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentSkill" ADD CONSTRAINT "AssessmentSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentTopic" ADD CONSTRAINT "AssessmentTopic_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentTopic" ADD CONSTRAINT "AssessmentTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentEntry" ADD CONSTRAINT "AssessmentEntry_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentEntry" ADD CONSTRAINT "AssessmentEntry_evaluateeId_fkey" FOREIGN KEY ("evaluateeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentEntry" ADD CONSTRAINT "AssessmentEntry_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "AssessmentResponse_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AssessmentEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "AssessmentResponse_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
