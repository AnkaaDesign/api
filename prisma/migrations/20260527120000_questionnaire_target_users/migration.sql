-- CreateTable
CREATE TABLE "QuestionnaireUser" (
    "questionnaireId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "QuestionnaireUser_pkey" PRIMARY KEY ("questionnaireId","userId")
);

-- CreateIndex
CREATE INDEX "QuestionnaireUser_questionnaireId_idx" ON "QuestionnaireUser"("questionnaireId");

-- CreateIndex
CREATE INDEX "QuestionnaireUser_userId_idx" ON "QuestionnaireUser"("userId");

-- AddForeignKey
ALTER TABLE "QuestionnaireUser" ADD CONSTRAINT "QuestionnaireUser_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireUser" ADD CONSTRAINT "QuestionnaireUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

