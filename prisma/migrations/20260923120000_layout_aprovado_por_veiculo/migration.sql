-- O LAYOUT APROVADO PASSA A PODER SER POR VEÍCULO.
--
-- Até aqui o layout aprovado era do ORÇAMENTO (`File.quoteLayoutId`, no máximo
-- dois) e valia para todos os veículos dele: ao gravar, cada arte era aprovada
-- em cada caminhão e tudo o mais era reprovado em todos. O orçamento nº 990
-- (Carlotti, 22/09/2026) mostrou o custo: dois caminhões com o mesmo preço, mas
-- cada um com a SUA pintura. Escolher a arte do segundo reprovava a do primeiro
-- na galeria dele; escolher as duas deixava as duas aprovadas nos dois; e três
-- veículos com três artes não cabiam no limite de duas.
--
-- `layoutScope` diz como ler a lista:
--   SHARED       toda arte vale para todo veículo — o comportamento de sempre;
--   PER_VEHICLE  as linhas de `BudgetLayoutTask` são a verdade.
--
-- SEM BACKFILL, de propósito: todo orçamento existente nasce SHARED, que é
-- exatamente o que ele significava ontem. Nenhuma linha de cobertura é
-- inventada, e nenhum documento já assinado muda de leitura — a projeção
-- material de um SHARED é a mesma de antes desta migration.

CREATE TYPE "QuoteLayoutScope" AS ENUM ('SHARED', 'PER_VEHICLE');

ALTER TABLE "Budget" ADD COLUMN "layoutScope" "QuoteLayoutScope" NOT NULL DEFAULT 'SHARED';

-- A cobertura: "esta arte vale para este veículo". Sem `budgetId` — o dono da
-- arte (`File.quoteLayoutId`) e o dono do veículo (`Task.quoteId`) já dizem de
-- qual orçamento a linha é, e um terceiro ponteiro só criaria o caso em que eles
-- discordam. `CASCADE` dos dois lados: sem a arte ou sem o veículo a afirmação
-- não tem sujeito, e um veículo apagado nunca ganha cobertura de volta.
CREATE TABLE "BudgetLayoutTask" (
  "fileId"    TEXT NOT NULL,
  "taskId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BudgetLayoutTask_pkey" PRIMARY KEY ("fileId", "taskId")
);

CREATE INDEX "BudgetLayoutTask_taskId_idx" ON "BudgetLayoutTask"("taskId");

ALTER TABLE "BudgetLayoutTask" ADD CONSTRAINT "BudgetLayoutTask_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLayoutTask" ADD CONSTRAINT "BudgetLayoutTask_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
