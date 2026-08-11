-- Segundo eixo do peso da bonificação: DISPONIBILIDADE (afastamento médico).
--
-- `eligibilityWeight` passa a ser o peso FINAL (temporal × afastamento). Estas
-- colunas guardam a parcela do afastamento para que um período fechado consiga
-- se explicar sem reconsultar o Secullum — que reescreve o passado, já que um
-- atestado lançado com atraso muda a resposta de meses atrás.
--
-- ADITIVA E SEGURA PARA APLICAR ANTES DO CÓDIGO: `absenceFactor` nasce 1 em
-- toda linha existente, que é exatamente o comportamento anterior à regra
-- (ninguém tinha fator de afastamento), e `absentDays` nasce NULL = "não
-- medido". Nenhum valor histórico muda.

ALTER TABLE "Bonus"
  ADD COLUMN IF NOT EXISTS "absenceFactor" DECIMAL(6, 4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "absentDays" DECIMAL(6, 2);
