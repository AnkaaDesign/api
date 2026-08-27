-- B1 por pessoa (v4).
--
-- `Bonus.averageTaskPerUser` passa a guardar o B1 DESTA pessoa (medido nos dias
-- em que ela esteve) em vez do agregado do período. Estas duas colunas novas
-- preservam o que a coluna significava antes e o insumo que a produz:
--
--   periodAverageTasks = o agregado do período (o "número da equipe")
--   taskCredit         = Σ tarefas(dia)/headcount(dia) na janela da pessoa
--
-- Ambas nullable: linhas antigas (v3 e anteriores) continuam válidas e são
-- reconhecíveis justamente por terem NULL aqui.
ALTER TABLE "Bonus" ADD COLUMN IF NOT EXISTS "periodAverageTasks" DECIMAL(10,2);
ALTER TABLE "Bonus" ADD COLUMN IF NOT EXISTS "taskCredit" DECIMAL(10,4);

-- Backfill do que já é verdade sem recalcular nada: até a v3 a coluna
-- `averageTaskPerUser` ERA o agregado do período, então para as linhas
-- existentes as duas coincidem. `taskCredit` fica NULL de propósito — ele não
-- existia e não pode ser inventado.
UPDATE "Bonus" SET "periodAverageTasks" = "averageTaskPerUser" WHERE "periodAverageTasks" IS NULL;
