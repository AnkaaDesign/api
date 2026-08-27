-- Recorte de tarefas por janela (complementa o B1 por pessoa da v4).
--
-- Até aqui toda linha `Bonus` do mês carregava as MESMAS tarefas do período —
-- inclusive na linha de quem foi desligado no meio, que assim aparecia com
-- tarefas fechadas depois de sair.
ALTER TABLE "Bonus" ADD COLUMN IF NOT EXISTS "windowTaskCount" INTEGER;
ALTER TABLE "Bonus" ADD COLUMN IF NOT EXISTS "windowWeightedTasks" DECIMAL(10,2);

-- Backfill do que já é verdade: quem cobriu o período inteiro tem janela ==
-- período. Para os demais fica NULL — não dá para reconstruir sem recalcular.
UPDATE "Bonus" SET "windowWeightedTasks" = "weightedTasks"
WHERE "windowWeightedTasks" IS NULL
  AND "eligibleDays" IS NOT NULL
  AND "periodBusinessDays" IS NOT NULL
  AND "eligibleDays" = "periodBusinessDays";

-- Headcount médio durante a janela de cada pessoa.
ALTER TABLE "Bonus" ADD COLUMN IF NOT EXISTS "windowDivisor" DECIMAL(8,4);
UPDATE "Bonus" SET "windowDivisor" = "periodDivisor"
WHERE "windowDivisor" IS NULL
  AND "eligibleDays" IS NOT NULL AND "periodBusinessDays" IS NOT NULL
  AND "eligibleDays" = "periodBusinessDays";
