-- Numeração da DPS passa a ser por AMBIENTE.
--
-- A SEFIN mantém espaços de numeração separados para produção e produção
-- restrita. Com um contador único para os dois, testar em homologação queima
-- números que depois colidem na emissão seguinte — rejeição E0014
-- ("Conjunto de Série, Número, Município e CNPJ já existe"), que foi
-- exatamente o que apareceu ao testar a reemissão.

ALTER TABLE "FiscalDpsSequence" ADD COLUMN "environment" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "FiscalDpsSequence"
  ADD CONSTRAINT "FiscalDpsSequence_environment_range" CHECK ("environment" IN (1, 2));

DROP INDEX IF EXISTS "FiscalDpsSequence_profileId_serie_key";

CREATE UNIQUE INDEX "FiscalDpsSequence_profileId_serie_environment_key"
  ON "FiscalDpsSequence"("profileId", "serie", "environment");
