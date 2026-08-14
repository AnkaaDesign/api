-- Código de tributação nacional padrão: 140501 → 141201.
--
-- Não é preferência de projeto. Foram lidas, pela distribuição de DF-e do ADN,
-- as 42 NFS-e que o aerografista já emitiu pelo portal nacional, e TODAS usam
-- 141201 (LC 116, item 14.12 — funilaria e lanternagem). É também o código da
-- configuração Elotech da própria empresa (ELOTECH_OXY_SERVICO_LC_ID).
--
-- O 140501 ("restauração, ..., pintura, ... de objetos quaisquer", item 14.05)
-- parece mais literal para aerografia, mas emitir num código diferente do que o
-- prestador sempre usou criaria inconsistência no histórico fiscal dele — e do
-- tipo que ninguém percebe até a fiscalização perguntar.
--
-- Linhas que ainda estão no padrão antigo são migradas; quem escolheu outro
-- código à mão é preservado.

ALTER TABLE "FiscalEmitterProfile" ALTER COLUMN "cTribNac" SET DEFAULT '141201';

UPDATE "FiscalEmitterProfile" SET "cTribNac" = '141201' WHERE "cTribNac" = '140501';
