-- Substituição de NFS-e: o elo entre "revert deixa a nota viva" e "reaprovar emite a nova".
--
-- Ibiporã entrega o SubstituirNfseEnvio atômico do ABRASF 2.03 DESLIGADO
-- (parâmetro HABILITASOLSUBSTITUICAONFSE = "N") e não expõe rota de substituição no portal,
-- então a substituição é feita por nós em dois passos. Estas colunas registram a intenção
-- entre um passo e outro: sem elas, um cancelamento que falha no meio não tem como ser
-- retomado, porque o número da nota substituta — justamente o que o fiscal exige — se perde.
--
-- Distintas de "cancelSubstituteNfseNumber", que é sobrescrita a cada envio (é o que foi
-- ENVIADO). Estas são a intenção durável e sobrevivem a rejeições repetidas.
--
-- Aditiva e idempotente: todas as colunas são nullable, nenhum backfill é necessário, e a
-- migration pode entrar antes ou depois do deploy do código sem quebrar nenhuma das versões.

ALTER TABLE "NfseDocument"
  ADD COLUMN IF NOT EXISTS "supersededByNfseDocumentId" TEXT,
  ADD COLUMN IF NOT EXISTS "supersededByNfseNumber"     INTEGER,
  ADD COLUMN IF NOT EXISTS "supersededAt"               TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "NfseDocument_supersededByNfseDocumentId_idx"
  ON "NfseDocument"("supersededByNfseDocumentId");

-- SET NULL, nunca CASCADE: perder a nota substituta jamais pode apagar o documento fiscal
-- que ela substituiu.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'NfseDocument_supersededByNfseDocumentId_fkey'
  ) THEN
    ALTER TABLE "NfseDocument"
      ADD CONSTRAINT "NfseDocument_supersededByNfseDocumentId_fkey"
      FOREIGN KEY ("supersededByNfseDocumentId") REFERENCES "NfseDocument"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
