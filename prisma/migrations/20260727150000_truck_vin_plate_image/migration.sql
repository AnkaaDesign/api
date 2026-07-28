-- "Plaqueta" deixa de ser TEXTO e passa a ser a FOTO da plaqueta de identificação (VIN).
--
-- O campo de texto criado em 20260724120000_truck_vin_plate era preenchido à mão e ficava
-- vazio em quase toda tarefa em andamento. O que a produção precisa registrar é a foto
-- legível da plaqueta rebitada no veículo, então `vinPlate text` vira `vinPlateId` -> File.
--
-- ATENÇÃO — ISTO DESCARTA o conteúdo textual de Truck.vinPlate. Não existe conversão de
-- texto para arquivo. O texto que existir é copiado para "_DroppedTruckVinPlateText" antes
-- do DROP, para que nada seja destruído em silêncio; essa tabela pode ser removida depois
-- de conferida em produção.
--
-- A coluna gerada "vinPlateNormalized" é derivada de "vinPlate" e precisa cair ANTES dela.
-- O DROP é explícito (e não CASCADE) de propósito: CASCADE arrastaria qualquer outra
-- dependência que venha a existir sem aparecer no diff.

-- 1. Arquiva o texto existente (só as linhas que realmente têm valor).
CREATE TABLE IF NOT EXISTS "_DroppedTruckVinPlateText" (
  "truckId"    text PRIMARY KEY,
  "vinPlate"   text NOT NULL,
  "archivedAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "_DroppedTruckVinPlateText" ("truckId", "vinPlate")
SELECT "id", "vinPlate"
FROM "Truck"
WHERE "vinPlate" IS NOT NULL AND btrim("vinPlate") <> ''
ON CONFLICT ("truckId") DO NOTHING;

-- 2. Derruba a coluna gerada e, em seguida, a coluna de texto.
ALTER TABLE "Truck" DROP COLUMN IF EXISTS "vinPlateNormalized";
ALTER TABLE "Truck" DROP COLUMN IF EXISTS "vinPlate";

-- 3. Cria a referência para File.
ALTER TABLE "Truck" ADD COLUMN IF NOT EXISTS "vinPlateId" text;

CREATE INDEX IF NOT EXISTS "Truck_vinPlateId_idx" ON "Truck" ("vinPlateId");

-- onDelete: SetNull — apagar o arquivo não pode apagar o caminhão.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Truck_vinPlateId_fkey'
  ) THEN
    ALTER TABLE "Truck"
      ADD CONSTRAINT "Truck_vinPlateId_fkey"
      FOREIGN KEY ("vinPlateId") REFERENCES "File"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
