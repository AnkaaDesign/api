-- M1 — Truck vira Implement (release R-B; PLANO §3.1, §4.2; D-04).
--
-- FATIA ESCRITA E ENSAIADA NO P10, PROMOVIDA PELO P11a (protocolo do §4.1).
-- Blocos do esquema-alvo que esta fatia traz (prisma/staged/r-b/schema.alvo.prisma):
--   · model Implement (era Truck): nome, `type` (era `implementType`), `category ImplementCategory`,
--     relações IMPLEMENT_VIN_PLATE / IMPLEMENT_BACK_SIDE / _LEFT_SIDE / _RIGHT_SIDE (nomes de relação
--     não existem no banco) com onDelete SetNull nas medidas (o catálogo JÁ é SET NULL);
--   · Task.implement (era Task.truck); File.implementVinPlates; ImplementMeasure.implements*Side;
--   · enum ImplementCategory (era TruckCategory).
--   (serialNumber/spot sem default são da M1s; frente/porta/projeto da M2; layouts da M3.)
--
-- Só catálogo: nenhum byte de dado muda. Os nomes abaixo foram conferidos no catálogo do
-- ankaa_implemento (23/09): 1 PK, 5 FKs, 8 índices; nenhuma FK de outra tabela aponta para "Truck";
-- o tipo "TruckCategory" só é usado por "Truck"."category"; as colunas geradas
-- ("plateNormalized", "chassisNumberNormalized") acompanham o RENAME sem ação.
--
-- NÃO renomeados, de propósito (D-04): o valor 'TRUCK' de ChangeLogEntityType e de
-- ChangeLogTriggeredByType, o tipo TRUCK_SPOT, o tipo ImplementType, o enum TruckManufacturer
-- (montadora da tinta) e as chaves 'truck.*' gravadas em TaskFieldChangeLog e em notificação.
--
-- Idempotente (§4.5): cada RENAME só roda se o nome velho existe e o novo não.
-- ⚠️ Em PRODUÇÃO, antes do deploy, conferir os mesmos nomes (P30):
--    SELECT conname FROM pg_constraint WHERE conrelid = '"Truck"'::regclass;
--    SELECT indexname FROM pg_indexes WHERE tablename = 'Truck';
--    Nome que não existir lá fica sem renomear em silêncio aqui — o ensaio (--deriva) acusa.
-- Reversão: os mesmos RENAMEs com os lados trocados.

-- 1. A TABELA
DO $$ BEGIN
  IF to_regclass('public."Truck"') IS NOT NULL AND to_regclass('public."Implement"') IS NULL THEN
    ALTER TABLE "Truck" RENAME TO "Implement";
  END IF;
END $$;

-- 2. CONSTRAINTS (PK e FKs). Renomear a constraint da PK renomeia o índice dela junto.
DO $$
DECLARE par text[];
BEGIN
  FOREACH par SLICE 1 IN ARRAY ARRAY[
    ['Truck_pkey',                    'Implement_pkey'],
    ['Truck_taskId_fkey',             'Implement_taskId_fkey'],
    ['Truck_vinPlateId_fkey',         'Implement_vinPlateId_fkey'],
    ['Truck_backSideMeasureId_fkey',  'Implement_backSideMeasureId_fkey'],
    ['Truck_leftSideMeasureId_fkey',  'Implement_leftSideMeasureId_fkey'],
    ['Truck_rightSideMeasureId_fkey', 'Implement_rightSideMeasureId_fkey']
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"Implement"'::regclass AND conname = par[1])
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"Implement"'::regclass AND conname = par[2]) THEN
      EXECUTE format('ALTER TABLE "Implement" RENAME CONSTRAINT %I TO %I', par[1], par[2]);
    END IF;
  END LOOP;
END $$;

-- 3. ÍNDICES (os únicos do Prisma são índices, não constraints)
DO $$
DECLARE par text[];
BEGIN
  FOREACH par SLICE 1 IN ARRAY ARRAY[
    ['Truck_taskId_key',             'Implement_taskId_key'],
    ['Truck_plate_key',              'Implement_plate_key'],
    ['Truck_plate_idx',              'Implement_plate_idx'],
    ['Truck_spot_idx',               'Implement_spot_idx'],
    ['Truck_vinPlateId_idx',         'Implement_vinPlateId_idx'],
    ['Truck_backSideMeasureId_idx',  'Implement_backSideMeasureId_idx'],
    ['Truck_leftSideMeasureId_idx',  'Implement_leftSideMeasureId_idx'],
    ['Truck_rightSideMeasureId_idx', 'Implement_rightSideMeasureId_idx']
  ] LOOP
    IF to_regclass(format('public.%I', par[1])) IS NOT NULL AND to_regclass(format('public.%I', par[2])) IS NULL THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', par[1], par[2]);
    END IF;
  END LOOP;
END $$;

-- 4. COLUNA implementType → type
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'Implement' AND column_name = 'implementType')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'Implement' AND column_name = 'type') THEN
    ALTER TABLE "Implement" RENAME COLUMN "implementType" TO "type";
  END IF;
END $$;

-- 5. TIPO TruckCategory → ImplementCategory (valores inalterados)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TruckCategory')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImplementCategory') THEN
    ALTER TYPE "TruckCategory" RENAME TO "ImplementCategory";
  END IF;
END $$;
