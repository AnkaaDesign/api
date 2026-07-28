-- Separa "o documento mudou" de "a proposta mudou".
--
-- Até aqui um único hash cobria tudo que o documento exibe, e qualquer
-- divergência invalidava o envelope. O orçamento nº 590 foi invalidado porque
-- alguém corrigiu "Paulo Cvarvalho" para "Paulo Carvalho" — uma assinatura
-- válida, com OTP verificado e evidência gravada, destruída por um typo.
--
-- `quoteTermsSha256` cobre apenas as condições comerciais. É ele que passa a
-- decidir invalidação; `quoteSnapshotSha256` segue como prova do que foi exibido.

ALTER TABLE "SignatureEnvelope" ADD COLUMN "quoteTermsSha256" TEXT;

ALTER TYPE "SignatureEventType" ADD VALUE 'SNAPSHOT_DRIFTED' BEFORE 'ENVELOPE_INVALIDATED';

-- Sem backfill em SQL de propósito.
--
-- O hash material vem de uma projeção canônica (RFC 8785) sobre o JSONB
-- congelado, com normalização de texto e ordenação estável — reproduzir isso em
-- PL/pgSQL daria um hash sutilmente diferente do que o código calcula, e o
-- resultado seria pior que a ausência: TODO envelope pré-migração invalidaria na
-- primeira checagem.
--
-- A coluna fica NULL, e `onQuoteContentChanged` deriva o baseline do snapshot
-- congelado quando encontra NULL (mesmo cálculo, mesmo código). Envelopes novos
-- já nascem com o valor preenchido.
