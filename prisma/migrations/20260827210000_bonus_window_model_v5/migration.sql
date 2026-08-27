-- v5: B1 é o agregado da JANELA de cada pessoa.
--
--     windowWeightedTasks ÷ windowDivisor == averageTaskPerUser
--
-- `taskCredit` guardava o rateio pessoa-dia (Σ tarefas(d)/headcount(d)) de um
-- modelo intermediário que não foi adiante. Sob a v5 a coluna não tem
-- significado — mantê-la seria oferecer um número que nenhuma tela usa e que
-- ninguém consegue explicar. Só existia dados nela para 08/2026, que está sendo
-- recalculado nesta mesma janela.
ALTER TABLE "Bonus" DROP COLUMN IF EXISTS "taskCredit";
