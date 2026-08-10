-- Público-alvo por setor / cargo / colaborador.
--
-- POR QUÊ. O alvo de uma campanha era um booleano: `targetAllUsers` ou a lista
-- explícita de pessoas (`QuestionnaireUser`). Montar "o setor de Produção
-- inteiro" obrigava o admin a caçar colaborador por colaborador num combobox — e
-- quem entrasse no setor depois simplesmente não recebia a ficha.
--
-- MODELAGEM. `audience` diz COMO o alvo é escolhido; `targetSectorIds` /
-- `targetPositionIds` guardam o critério. A conversão em pessoas continua
-- acontecendo em `openQuestionnaire` — é isso que faz o critério valer no
-- momento certo (quem entrou no setor entre o rascunho e a abertura entra
-- junto). Os ids ficam soltos, sem FK, porque são FILTRO e não vínculo: um setor
-- apagado deixa de casar em vez de travar a exclusão do setor.
--
-- `targetAllUsers` sai de cena: manter o booleano ao lado do enum criaria duas
-- fontes de verdade para a mesma pergunta ("quem responde?"). O valor antigo é
-- traduzido 1:1 — true → ALL_USERS, false → USERS (o único outro modo que
-- existia, já materializado em QuestionnaireUser).

-- CreateEnum
CREATE TYPE "QuestionnaireAudience" AS ENUM ('ALL_USERS', 'SECTORS', 'POSITIONS', 'USERS');

-- AlterTable
ALTER TABLE "Questionnaire"
  ADD COLUMN "audience" "QuestionnaireAudience" NOT NULL DEFAULT 'ALL_USERS',
  ADD COLUMN "targetSectorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "targetPositionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Traduz o booleano antigo antes de removê-lo.
UPDATE "Questionnaire"
   SET "audience" = CASE
     WHEN "targetAllUsers" THEN 'ALL_USERS'::"QuestionnaireAudience"
     ELSE 'USERS'::"QuestionnaireAudience"
   END;

-- AlterTable
ALTER TABLE "Questionnaire" DROP COLUMN "targetAllUsers";
