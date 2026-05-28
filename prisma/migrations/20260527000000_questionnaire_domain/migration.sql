-- CreateEnum
CREATE TYPE "QuestionnaireStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuestionnaireEntryStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUBMITTED');

-- CreateTable
CREATE TABLE "QuestionnaireGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireQuestion" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "helpText" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Questionnaire" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "QuestionnaireStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "targetAllUsers" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Questionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireSector" (
    "questionnaireId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "QuestionnaireSector_pkey" PRIMARY KEY ("questionnaireId","sectorId")
);

-- CreateTable
CREATE TABLE "QuestionnaireQuestionLink" (
    "questionnaireId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,

    CONSTRAINT "QuestionnaireQuestionLink_pkey" PRIMARY KEY ("questionnaireId","questionId")
);

-- CreateTable
CREATE TABLE "QuestionnaireEntry" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "respondentId" TEXT NOT NULL,
    "status" "QuestionnaireEntryStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireAnswer" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireGroup_name_key" ON "QuestionnaireGroup"("name");

-- CreateIndex
CREATE INDEX "QuestionnaireGroup_order_idx" ON "QuestionnaireGroup"("order");

-- CreateIndex
CREATE INDEX "QuestionnaireGroup_isActive_idx" ON "QuestionnaireGroup"("isActive");

-- CreateIndex
CREATE INDEX "QuestionnaireGroup_deletedAt_idx" ON "QuestionnaireGroup"("deletedAt");

-- CreateIndex
CREATE INDEX "QuestionnaireQuestion_groupId_idx" ON "QuestionnaireQuestion"("groupId");

-- CreateIndex
CREATE INDEX "QuestionnaireQuestion_deletedAt_idx" ON "QuestionnaireQuestion"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireQuestion_groupId_order_key" ON "QuestionnaireQuestion"("groupId", "order");

-- CreateIndex
CREATE INDEX "QuestionnaireOption_questionId_idx" ON "QuestionnaireOption"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireOption_questionId_order_key" ON "QuestionnaireOption"("questionId", "order");

-- CreateIndex
CREATE INDEX "Questionnaire_status_idx" ON "Questionnaire"("status");

-- CreateIndex
CREATE INDEX "Questionnaire_periodStart_periodEnd_idx" ON "Questionnaire"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Questionnaire_createdById_idx" ON "Questionnaire"("createdById");

-- CreateIndex
CREATE INDEX "Questionnaire_deletedAt_idx" ON "Questionnaire"("deletedAt");

-- CreateIndex
CREATE INDEX "QuestionnaireSector_questionnaireId_idx" ON "QuestionnaireSector"("questionnaireId");

-- CreateIndex
CREATE INDEX "QuestionnaireSector_sectorId_idx" ON "QuestionnaireSector"("sectorId");

-- CreateIndex
CREATE INDEX "QuestionnaireQuestionLink_questionnaireId_idx" ON "QuestionnaireQuestionLink"("questionnaireId");

-- CreateIndex
CREATE INDEX "QuestionnaireQuestionLink_questionId_idx" ON "QuestionnaireQuestionLink"("questionId");

-- CreateIndex
CREATE INDEX "QuestionnaireEntry_questionnaireId_idx" ON "QuestionnaireEntry"("questionnaireId");

-- CreateIndex
CREATE INDEX "QuestionnaireEntry_respondentId_idx" ON "QuestionnaireEntry"("respondentId");

-- CreateIndex
CREATE INDEX "QuestionnaireEntry_status_idx" ON "QuestionnaireEntry"("status");

-- CreateIndex
CREATE INDEX "QuestionnaireEntry_deletedAt_idx" ON "QuestionnaireEntry"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireEntry_questionnaireId_respondentId_key" ON "QuestionnaireEntry"("questionnaireId", "respondentId");

-- CreateIndex
CREATE INDEX "QuestionnaireAnswer_entryId_idx" ON "QuestionnaireAnswer"("entryId");

-- CreateIndex
CREATE INDEX "QuestionnaireAnswer_questionId_idx" ON "QuestionnaireAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireAnswer_entryId_questionId_key" ON "QuestionnaireAnswer"("entryId", "questionId");

-- AddForeignKey
ALTER TABLE "QuestionnaireQuestion" ADD CONSTRAINT "QuestionnaireQuestion_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "QuestionnaireGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireOption" ADD CONSTRAINT "QuestionnaireOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionnaireQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Questionnaire" ADD CONSTRAINT "Questionnaire_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireSector" ADD CONSTRAINT "QuestionnaireSector_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireSector" ADD CONSTRAINT "QuestionnaireSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireQuestionLink" ADD CONSTRAINT "QuestionnaireQuestionLink_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireQuestionLink" ADD CONSTRAINT "QuestionnaireQuestionLink_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionnaireQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireEntry" ADD CONSTRAINT "QuestionnaireEntry_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireEntry" ADD CONSTRAINT "QuestionnaireEntry_respondentId_fkey" FOREIGN KEY ("respondentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireAnswer" ADD CONSTRAINT "QuestionnaireAnswer_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "QuestionnaireEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireAnswer" ADD CONSTRAINT "QuestionnaireAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionnaireQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

