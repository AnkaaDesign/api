-- Espelho de `terminatedAt`: quando a elegibilidade COMEÇOU dentro do período.
-- Sem isto a UI só sabia explicar peso parcial por desligamento.
ALTER TABLE "Bonus" ADD COLUMN IF NOT EXISTS "effectedAt" TIMESTAMP(3);
