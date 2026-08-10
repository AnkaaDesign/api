-- Pergunta de texto livre + pergunta opcional.
--
-- POR QUÊ. O catálogo de perguntas só sabia fazer UMA coisa: escolha fechada
-- entre 2 e 6 opções numeradas, TODAS obrigatórias. Duas lacunas apareceram:
--
--   1. Nem toda pergunta cabe numa escala. "O que você mudaria no setor?" quer
--      texto livre — hoje isso obrigaria o admin a inventar uma escala falsa.
--   2. Toda pergunta ligada a uma campanha bloqueava o envio da ficha
--      (submitEntry exigia resposta para TODAS). Não havia como marcar uma
--      pergunta como opcional.
--
-- MODELAGEM. `QuestionnaireQuestion.type` separa os dois mundos (OPTIONS ×
-- TEXT) e `isRequired` libera o envio com a pergunta em branco. Do lado da
-- resposta, `QuestionnaireAnswer.value` PRECISA virar nullable: uma resposta de
-- texto não tem nota e nunca deve entrar nas médias/distribuições de
-- `GET /questionnaire/:id/results`. O texto vai em `textValue` — coluna nova e
-- separada de `comment`, que continua sendo o comentário OPCIONAL de uma
-- resposta fechada.
--
-- COMPATIBILIDADE. Os defaults preservam o comportamento atual de todo o
-- acervo existente (COPSOQ-II e afins): type=OPTIONS, isRequired=true. Nenhuma
-- linha de QuestionnaireAnswer é tocada — apenas o NOT NULL de `value` cai.

-- CreateEnum
CREATE TYPE "QuestionnaireQuestionType" AS ENUM ('OPTIONS', 'TEXT');

-- AlterTable
ALTER TABLE "QuestionnaireQuestion"
  ADD COLUMN "type" "QuestionnaireQuestionType" NOT NULL DEFAULT 'OPTIONS',
  ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "QuestionnaireQuestion_type_idx" ON "QuestionnaireQuestion"("type");

-- AlterTable
ALTER TABLE "QuestionnaireAnswer"
  ALTER COLUMN "value" DROP NOT NULL,
  ADD COLUMN "textValue" TEXT;
