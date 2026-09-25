-- M2 — frente e porta traseira do implemento, medidas descompartilhadas e o projeto do implemento
-- (release R-B; R5, R6, D-06, D-07, DD4; PLANO §3.1, §3.3, §4.3).
--
-- FATIA ESCRITA E ENSAIADA NO P10, PROMOVIDA PELO P11b (protocolo do §4.1).
-- Blocos do esquema-alvo que esta fatia traz:
--   · Implement.frontSideMeasureId + frontSideMeasure (IMPLEMENT_FRONT_SIDE, SetNull) + @@index;
--   · Implement.rearDoorLeaves (RearDoorLeaves?), rearDoorBarCount / rearDoorHatchCount (Int? @db.SmallInt);
--   · Implement.projectFiles (M2M "_IMPLEMENT_PROJECT_FILES") e File.implementProjectFiles;
--   · ImplementMeasure.implementsFrontSide.
--   O DDL de "_IMPLEMENT_PROJECT_FILES" veio da M3 para cá na Revisão 3.1: o P13a grava o projeto do
--   implemento antes da M3. Os DADOS do projeto (os 4 de hoje e os PDFs da Furgões) ficam na M3.
-- Objetos de banco (G25; bloco "M2" de objetos-pos-push.r-b.sql): 2 CHECKs.
--
-- Pré-condição: M1 (nome da tabela) e M0 (tipo "RearDoorLeaves").
-- Idempotente (§4.5): IF NOT EXISTS nas colunas/índices/tabela, DO … pg_constraint nas constraints;
-- o descompartilhamento não acha nada a fazer na segunda rodada.

-- 1. A FRENTE
ALTER TABLE "Implement" ADD COLUMN IF NOT EXISTS "frontSideMeasureId" TEXT;
CREATE INDEX IF NOT EXISTS "Implement_frontSideMeasureId_idx" ON "Implement"("frontSideMeasureId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Implement_frontSideMeasureId_fkey') THEN
    ALTER TABLE "Implement" ADD CONSTRAINT "Implement_frontSideMeasureId_fkey"
      FOREIGN KEY ("frontSideMeasureId") REFERENCES "ImplementMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. A PORTA TRASEIRA (DD4: varões 2|3|4 no total; portinholas 0..6, só quantidade;
--    bipartida/tripartida é preset das folhas). Nulo = não informado.
ALTER TABLE "Implement"
  ADD COLUMN IF NOT EXISTS "rearDoorLeaves"     "RearDoorLeaves",
  ADD COLUMN IF NOT EXISTS "rearDoorBarCount"   SMALLINT,
  ADD COLUMN IF NOT EXISTS "rearDoorHatchCount" SMALLINT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Implement_rearDoorBarCount_check') THEN
    ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorBarCount_check"
      CHECK ("rearDoorBarCount" IS NULL OR "rearDoorBarCount" IN (2, 3, 4));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Implement_rearDoorHatchCount_check') THEN
    ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorHatchCount_check"
      CHECK ("rearDoorHatchCount" IS NULL OR "rearDoorHatchCount" BETWEEN 0 AND 6);
  END IF;
END $$;

-- 3. PROJETO DO IMPLEMENTO (R6): a tabela do M2M. Ordem alfabética do Prisma: A = File, B = Implement.
CREATE TABLE IF NOT EXISTS "_IMPLEMENT_PROJECT_FILES" (
  "A" text NOT NULL,
  "B" text NOT NULL,
  CONSTRAINT "_IMPLEMENT_PROJECT_FILES_AB_pkey" PRIMARY KEY ("A", "B"),
  CONSTRAINT "_IMPLEMENT_PROJECT_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_IMPLEMENT_PROJECT_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "Implement"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "_IMPLEMENT_PROJECT_FILES_B_index" ON "_IMPLEMENT_PROJECT_FILES"("B");

-- 4. D-07: desfaz as medidas COMPARTILHADAS. O 1º (implemento, face) por createdAt da tarefa fica com
--    a linha; os demais ganham cópia com as mesmas seções e a mesma foto (o arquivo não é copiado).
--    Vale também para o mesmo implemento usando a mesma medida em duas faces.
--    Clone 23/09: 11 linhas × 41 referências → 30 cópias; produção 23/09: 11 linhas, 26 cópias.
CREATE TABLE IF NOT EXISTS "_Mig0924_MeasureUnshare" ("implementId" text, face text, "oldMid" text, "newMid" text);
DROP TABLE IF EXISTS pg_temp._m2_refs;
CREATE TEMP TABLE _m2_refs ON COMMIT DROP AS
SELECT i."id" AS "implementId", t."createdAt" AS tc, f.face, f.mid
FROM "Implement" i JOIN "Task" t ON t."id" = i."taskId"
CROSS JOIN LATERAL (VALUES ('back', i."backSideMeasureId"), ('left', i."leftSideMeasureId"),
                           ('right', i."rightSideMeasureId"), ('front', i."frontSideMeasureId")) AS f(face, mid)
WHERE f.mid IS NOT NULL;
DROP TABLE IF EXISTS pg_temp._m2_share;
CREATE TEMP TABLE _m2_share ON COMMIT DROP AS
SELECT r.*, gen_random_uuid()::text AS "newMid",
       row_number() OVER (PARTITION BY r.mid ORDER BY r.tc, r."implementId", r.face) AS rn
FROM _m2_refs r
WHERE r.mid IN (SELECT mid FROM _m2_refs GROUP BY mid HAVING count(*) > 1);
INSERT INTO "ImplementMeasure" ("id", "height", "photoId", "createdAt", "updatedAt")
SELECT s."newMid", m."height", m."photoId", m."createdAt", now()
FROM _m2_share s JOIN "ImplementMeasure" m ON m."id" = s.mid
WHERE s.rn > 1;
INSERT INTO "ImplementMeasureSection" ("id", "implementMeasureId", "width", "isDoor", "doorHeight", "position", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."newMid", x."width", x."isDoor", x."doorHeight", x."position", x."createdAt", now()
FROM _m2_share s JOIN "ImplementMeasureSection" x ON x."implementMeasureId" = s.mid
WHERE s.rn > 1;
UPDATE "Implement" i SET "backSideMeasureId"  = s."newMid" FROM _m2_share s WHERE s.rn > 1 AND s.face = 'back'  AND s."implementId" = i."id";
UPDATE "Implement" i SET "leftSideMeasureId"  = s."newMid" FROM _m2_share s WHERE s.rn > 1 AND s.face = 'left'  AND s."implementId" = i."id";
UPDATE "Implement" i SET "rightSideMeasureId" = s."newMid" FROM _m2_share s WHERE s.rn > 1 AND s.face = 'right' AND s."implementId" = i."id";
UPDATE "Implement" i SET "frontSideMeasureId" = s."newMid" FROM _m2_share s WHERE s.rn > 1 AND s.face = 'front' AND s."implementId" = i."id";
INSERT INTO "_Mig0924_MeasureUnshare" ("implementId", face, "oldMid", "newMid")
SELECT "implementId", face, mid, "newMid" FROM _m2_share WHERE rn > 1;

-- Reversão: DROP dos CHECKs, da FK/índice/coluna da frente e das colunas da porta; DROP TABLE
-- "_IMPLEMENT_PROJECT_FILES" (vazia até a M3); para as cópias, restaurar a FK a partir de
-- "_Mig0924_MeasureUnshare" e apagar as cópias. Perde o que alguém tiver digitado depois.
