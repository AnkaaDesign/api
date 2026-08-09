-- Bonificação proporcional ao tempo de elegibilidade no período 26→25.
--
-- Antes: o divisor B1 era `count(usuários elegíveis AGORA)`, lido do cache
-- User.currentContractStatus. Demitir alguém removia essa pessoa do denominador
-- RETROATIVAMENTE, enquanto as tarefas dela seguiam no numerador — inflando o
-- bônus de toda a folha (elasticidade ~5,7x na faixa operacional).
--
-- Agora o divisor é o headcount médio do período:
--   divisor = Σ (dias_úteis_elegíveis / dias_úteis_do_período)
-- e o mesmo peso prorrateia o bônus individual.
--
-- Todas as colunas são aditivas e nullable (ou com default), então linhas
-- históricas seguem legíveis. `eligibilityWeight` default 1 preserva a
-- semântica antiga das linhas já gravadas: peso cheio.

ALTER TABLE "Bonus"
  ADD COLUMN "eligibilityWeight"  DECIMAL(6,4) NOT NULL DEFAULT 1,
  ADD COLUMN "eligibleDays"       INTEGER,
  ADD COLUMN "periodBusinessDays" INTEGER,
  ADD COLUMN "periodDivisor"      DECIMAL(8,4),
  ADD COLUMN "terminatedAt"       TIMESTAMP(3);

-- Consultas da UI filtram "quem foi desligado neste período".
CREATE INDEX "Bonus_terminatedAt_idx" ON "Bonus"("terminatedAt");

-- Peso parcial é a exceção; o índice parcial mantém barata a busca por elas.
CREATE INDEX "Bonus_partial_weight_idx" ON "Bonus"("year", "month")
  WHERE "eligibilityWeight" < 1;
