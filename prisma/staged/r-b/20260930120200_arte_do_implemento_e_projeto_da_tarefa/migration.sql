-- M3 — a arte vai para o implemento e o projeto se separa em projeto da tarefa × projeto do
-- implemento (release R-B; R2, R6, D-11, D-12, D-13, DD5, DD6; PLANO §2A.9, §3.1, §3.3, §4.3).
--
-- FATIA ESCRITA E ENSAIADA NO P10, PROMOVIDA PELO P12 (protocolo do §4.1), no mesmo commit em
-- que `quoteArtworkOf` passa a alimentar o snapshot (G11: quem casava antes casa depois).
-- Blocos do esquema-alvo que esta fatia traz:
--   · model Layout inteiro (implementId, version, supersedesId, sentAt, decidedAt, approvalSource,
--     decidedBy*, decisionNote, fileSha256, createdById; status @default(DRAFT); @@unique por dono;
--     sem `tasks`) e model LayoutDecision;
--   · Implement.layouts; File.artLayouts (era `layouts Layout?`, to-one);
--   · Responsible/User: layoutsDecided, layoutDecisions;
--   · SAEM do Prisma: Task.layouts (M2M "_TaskLayouts", derrubado aqui), Budget.layoutFiles,
--     File.quoteLayoutId/quoteLayout (+ @@index), File.quoteLayoutTasks, Task.quoteLayoutCoverage e o
--     model BudgetLayoutTask. A COLUNA "File"."quoteLayoutId" (FK + índice) e a TABELA
--     "BudgetLayoutTask" FICAM no banco até a M4 (R-D): o processo velho as lê na janela do deploy.
-- Objetos de banco (G25; bloco "M3" de objetos-pos-push.r-b.sql): 2 CHECKs.
--
-- Ordem obrigatória: arquivo morto → estrutura aditiva → projeto do implemento (ANTES de encher
-- _TASK_PROJECT_FILES) → PDFs → fan-out das imagens → arte do orçamento → O.S. aguardando →
-- órfãos → constraints → drop do M2M.
-- REGRAS: nenhum DELETE FROM "File"; nenhum byte movido; a aerografia (Layout.airbrushingId) não é
-- tocada por passo nenhum — as linhas dela nunca ganham implementId e não são órfãs.
-- Idempotente (§4.5): IF NOT EXISTS / DO … pg_constraint / ON CONFLICT / WHERE NOT EXISTS. O fan-out
-- (passo 4) e a arte do orçamento (passo 5) leem "_TaskLayouts", derrubado no passo 9 desta mesma
-- transação: re-rodar depois de um sucesso encontra os passos 2–6 sem fonte e só confere a estrutura.
-- Pré-condição: M0 (valores PENDING_APPROVAL/SUPERSEDED, tipo LayoutApprovalSource), M1, M1s, M2.

DO $$ BEGIN
  IF to_regclass('public."_TaskLayouts"') IS NULL THEN
    RAISE NOTICE 'M3: "_TaskLayouts" já não existe — os passos de dado (2 a 7) não têm fonte e ficam sem efeito';
  END IF;
END $$;

-- 0. ARQUIVO MORTO (reversão e auditoria; fica até uma limpeza explícita)
CREATE TABLE IF NOT EXISTS "_Mig0924_Layout"           AS SELECT * FROM "Layout";
DO $$ BEGIN
  IF to_regclass('public."_Mig0924_TaskLayouts"') IS NULL AND to_regclass('public."_TaskLayouts"') IS NOT NULL THEN
    CREATE TABLE "_Mig0924_TaskLayouts" AS SELECT * FROM "_TaskLayouts";
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "_Mig0924_TaskProjectFiles" AS SELECT * FROM "_TASK_PROJECT_FILES";
CREATE TABLE IF NOT EXISTS "_Mig0924_QuoteLayout"      AS
  SELECT "id" AS "fileId", "quoteLayoutId" FROM "File" WHERE "quoteLayoutId" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "_Mig0924_LayoutOrigin" (
  "layoutId" text PRIMARY KEY, "sourceLayoutId" text, "sourceQuoteFileId" text,
  "taskId" text NOT NULL, origin text NOT NULL);
CREATE TABLE IF NOT EXISTS "_Mig0924_ImplementCreated" ("implementId" text PRIMARY KEY, "taskId" text NOT NULL);
CREATE TABLE IF NOT EXISTS "_Mig0924_Triage" (kind text, "fileId" text, "taskId" text, note text);

-- 1. ESTRUTURA ADITIVA
ALTER TABLE "Layout"
  ADD COLUMN IF NOT EXISTS "implementId"            text,
  ADD COLUMN IF NOT EXISTS "version"                integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "supersedesId"           text,
  ADD COLUMN IF NOT EXISTS "sentAt"                 timestamp(3),
  ADD COLUMN IF NOT EXISTS "decidedAt"              timestamp(3),
  ADD COLUMN IF NOT EXISTS "approvalSource"         "LayoutApprovalSource",
  ADD COLUMN IF NOT EXISTS "decidedByResponsibleId" text,
  ADD COLUMN IF NOT EXISTS "decidedByUserId"        text,
  ADD COLUMN IF NOT EXISTS "decisionNote"           text,
  ADD COLUMN IF NOT EXISTS "fileSha256"             text,
  ADD COLUMN IF NOT EXISTS "createdById"            text;
-- No catálogo do clone "Layout_fileId_key" é CONSTRAINT UNIQUE; o Prisma novo cria @unique como
-- ÍNDICE. Os dois comandos cobrem as duas formas. O índice "Layout_fileId_idx" continua.
ALTER TABLE "Layout" DROP CONSTRAINT IF EXISTS "Layout_fileId_key";
DROP INDEX IF EXISTS "Layout_fileId_key";
CREATE TABLE IF NOT EXISTS "LayoutDecision" (
  "id"            text NOT NULL,
  "layoutId"      text NOT NULL,
  "toStatus"      "LayoutStatus" NOT NULL,
  "source"        "LayoutApprovalSource" NOT NULL,
  "responsibleId" text,
  "userId"        text,
  "note"          text,
  "fileSha256"    text,
  "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LayoutDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LayoutDecision_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- ⚠️ "Representative" é a tabela física do model Responsible
  CONSTRAINT "LayoutDecision_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LayoutDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LayoutDecision_layoutId_createdAt_idx" ON "LayoutDecision"("layoutId", "createdAt");

-- 1b. IMPLEMENTOS FALTANTES (spot NULL). NO-OP desde a Revisão 2: a M1s criou o implemento de TODA
--     tarefa (DD1). Fica, idempotente, como rede: se a M3 rodar sem a M1s (ensaio parcial), a arte
--     não vira "órfã" no passo 7 (os passos 2, 4 e 5 fazem JOIN interno com "Implement").
DO $$ BEGIN
  IF to_regclass('public."_TaskLayouts"') IS NOT NULL THEN
    WITH need AS (
      SELECT DISTINCT x."taskId" FROM (
        SELECT p."B" AS "taskId" FROM "_Mig0924_TaskProjectFiles" p
        UNION
        SELECT tl."B" FROM "_TaskLayouts" tl JOIN "Layout" l ON l."id" = tl."A" JOIN "File" f ON f."id" = l."fileId"
         WHERE f."mimetype" <> 'application/pdf'
        UNION
        SELECT t."id" FROM "File" qf JOIN "Budget" b ON b."id" = qf."quoteLayoutId" JOIN "Task" t ON t."quoteId" = b."id"
         WHERE qf."mimetype" <> 'application/pdf'
      ) x
      WHERE NOT EXISTS (SELECT 1 FROM "Implement" i WHERE i."taskId" = x."taskId")
    ), c AS (
      INSERT INTO "Implement" ("id", "taskId", "spot", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, "taskId", NULL, now(), now() FROM need
      RETURNING "id", "taskId"
    )
    INSERT INTO "_Mig0924_ImplementCreated" ("implementId", "taskId") SELECT "id", "taskId" FROM c;
  END IF;
END $$;

-- 2. OS projectFiles ATUAIS SÃO DA FURGÕES → projeto do implemento da mesma tarefa (D-11).
--    Clone e produção 23/09: 4 vínculos.
INSERT INTO "_IMPLEMENT_PROJECT_FILES" ("A", "B")
SELECT p."A", i."id" FROM "_Mig0924_TaskProjectFiles" p JOIN "Implement" i ON i."taskId" = p."B"
ON CONFLICT DO NOTHING;
--    Só sai da tarefa o vínculo que DE FATO foi copiado (e só na primeira rodada: os PDFs de layout
--    que o passo 3 põe em _TASK_PROJECT_FILES não estão no arquivo morto do projeto).
DELETE FROM "_TASK_PROJECT_FILES" p
USING "_Mig0924_TaskProjectFiles" o, "Implement" i, "_IMPLEMENT_PROJECT_FILES" ip
WHERE o."A" = p."A" AND o."B" = p."B" AND i."taskId" = o."B" AND ip."A" = o."A" AND ip."B" = i."id"
  AND to_regclass('public."_TaskLayouts"') IS NOT NULL;
--    D-11 (DECIDIDO, DD5): cópia do VÍNCULO dos PDFs da Furgões em baseFiles, só tarefas não
--    concluídas, por regra de nome, com trilha (o arquivo continua em baseFiles).
WITH c AS (
  INSERT INTO "_IMPLEMENT_PROJECT_FILES" ("A", "B")
  SELECT bf."A", i."id" FROM "_TASK_BASE_FILES" bf JOIN "File" f ON f."id" = bf."A"
    JOIN "Task" t ON t."id" = bf."B" JOIN "Implement" i ON i."taskId" = t."id"
   WHERE f."mimetype" = 'application/pdf' AND t."status" NOT IN ('COMPLETED', 'CANCELLED')
     AND (f."originalName" ~* '^PROJETO\s' OR f."originalName" ~ '^\d{5}.*LAYOUT')
  ON CONFLICT DO NOTHING
  RETURNING "A", "B"
)
INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
SELECT 'BASE_TO_IMPLEMENT_PROJECT', c."A", i."taskId", NULL
FROM c JOIN "Implement" i ON i."id" = c."B";

-- Os passos 3 a 6 leem "_TaskLayouts" e só rodam enquanto ela existe (na primeira rodada).
DO $m3$ BEGIN
IF to_regclass('public."_TaskLayouts"') IS NOT NULL THEN

  -- 3. PDF DO LAYOUT → PROJETO DA TAREFA (um vínculo por tarefa que o tinha) (D-12)
  INSERT INTO "_TASK_PROJECT_FILES" ("A", "B")
  SELECT l."fileId", tl."B" FROM "_TaskLayouts" tl
  JOIN "Layout" l ON l."id" = tl."A" JOIN "File" f ON f."id" = l."fileId"
  WHERE f."mimetype" = 'application/pdf' AND l."airbrushingId" IS NULL
  ON CONFLICT DO NOTHING;
  INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
  SELECT 'PDF_NOT_APPROVED', l."fileId", tl."B", l."status"::text
  FROM "_TaskLayouts" tl JOIN "Layout" l ON l."id" = tl."A" JOIN "File" f ON f."id" = l."fileId"
  WHERE f."mimetype" = 'application/pdf' AND l."status" <> 'APPROVED' AND l."airbrushingId" IS NULL;

  -- 4. IMAGEM (tudo que não é PDF) → ARTE DO IMPLEMENTO, UMA LINHA POR IMPLEMENTO (fan-out).
  --    O 1º vínculo (por createdAt da tarefa) HERDA o id original (histórico que cita o id continua
  --    resolvendo); os demais nascem com id novo e o MESMO status. Linha que já tem dono de
  --    aerografia NÃO herda (senão violaria "Layout_one_owner_check"): todas as tarefas dela
  --    recebem linha nova e a da aerografia fica intocada. Clone e produção 23/09: 0 casos.
  --    ⚠️ "tudo que não é PDF" inclui EPS/AI (clone 2, produção 4): viram arte, e vão à triagem
  --    'ART_NOT_IMAGE' (o upload novo só aceita imagem, §5.1).
  CREATE TEMP TABLE _m3_fan ON COMMIT DROP AS
  SELECT tl."A" AS "layoutId", tl."B" AS "taskId", i."id" AS "implementId", l."airbrushingId" AS "abId",
         row_number() OVER (PARTITION BY tl."A" ORDER BY t."createdAt", t."id") AS rn
  FROM "_TaskLayouts" tl JOIN "Layout" l ON l."id" = tl."A" JOIN "File" f ON f."id" = l."fileId"
  JOIN "Task" t ON t."id" = tl."B" JOIN "Implement" i ON i."taskId" = tl."B"
  WHERE f."mimetype" <> 'application/pdf';
  UPDATE "Layout" l SET "implementId" = fa."implementId",
    "approvalSource" = CASE WHEN l."status" = 'APPROVED' THEN 'MIGRATED_TASK'::"LayoutApprovalSource" END
  FROM _m3_fan fa WHERE fa."layoutId" = l."id" AND fa.rn = 1 AND fa."abId" IS NULL;
  WITH src AS (
    SELECT fa.*, gen_random_uuid()::text AS "newId" FROM _m3_fan fa WHERE fa.rn > 1 OR fa."abId" IS NOT NULL
  ), ins AS (
    INSERT INTO "Layout" ("id", "fileId", "status", "implementId", "approvalSource", "createdAt", "updatedAt")
    SELECT s."newId", l."fileId", l."status", s."implementId",
           CASE WHEN l."status" = 'APPROVED' THEN 'MIGRATED_TASK'::"LayoutApprovalSource" END, l."createdAt", now()
    FROM src s JOIN "Layout" l ON l."id" = s."layoutId"
    RETURNING "id"
  )
  INSERT INTO "_Mig0924_LayoutOrigin" ("layoutId", "sourceLayoutId", "taskId", origin)
  SELECT s."newId", s."layoutId", s."taskId", 'FANOUT' FROM src s WHERE s."newId" IN (SELECT "id" FROM ins);
  INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
  SELECT DISTINCT 'ART_NOT_IMAGE', l."fileId", fa."taskId", f."mimetype"
  FROM _m3_fan fa JOIN "Layout" l ON l."id" = fa."layoutId" JOIN "File" f ON f."id" = l."fileId"
  WHERE f."mimetype" NOT LIKE 'image/%';

  -- 5. LAYOUT DO ORÇAMENTO → ARTE EM CADA IMPLEMENTO DO ORÇAMENTO (D-13, §2A.9; reescrito na Revisão 2).
  --    A arte CONTINUA no hash material da assinatura (v7, layoutFileIds). Para que todo envelope
  --    RUNNING/COMPLETED que casava antes case depois:
  --    M-A: a arte nasce SEMPRE com o próprio File.id do orçamento (a maioria são clones: outro
  --         File.id que o da galeria). NUNCA se promove o "gêmeo" da galeria.
  --    M-B: nos orçamentos com coleta RUNNING/COMPLETED, as outras imagens APPROVED desses
  --         implementos saem de APPROVED (SUPERSEDED) — inclusive quando o orçamento não tinha
  --         layout nenhum (desvio do P10 sobre o rascunho, que só olhava orçamento com layout:
  --         o congelado ali é `layoutFileIds: []` e qualquer APPROVED da galeria entraria na união).
  --         Nos demais orçamentos elas FICAM (V13: SUPERSEDED esconderia arte do chão em tarefa em voo).
  --    M-C: coleta RUNNING/COMPLETED ⇒ APPROVED (MIGRATED_ENVELOPE) mesmo com o orçamento PENDING/REQUESTED.
  --    M-D: todo implemento do orçamento SHARED — canceladas inclusive, como em `vehicles[]` — recebe o
  --         MESMO conjunto (cobertura uniforme ⇒ sem layoutCoverage ⇒ hash igual).
  --    DD6: em "layoutScope" = 'PER_VEHICLE' cada implemento recebe SÓ os pares ("fileId","taskId") de
  --         "BudgetLayoutTask" (a verdade congelada em layoutCoverage). Clone e produção 23/09: 0.
  CREATE TEMP TABLE _m3_q ON COMMIT DROP AS
  SELECT qf."id" AS "qFileId", b."id" AS "budgetId", b."status"::text AS bstatus, t."id" AS "taskId",
         i."id" AS "implementId", qf."mimetype" AS mime, qf."path",
         lower(btrim(coalesce(qf."originalName", qf."filename"))) || '::' || qf."size" AS ik,
         EXISTS (SELECT 1 FROM "SignatureEnvelope" e
                 WHERE e."quoteId" = b."id" AND e."status" IN ('RUNNING', 'COMPLETED')) AS live
  FROM "File" qf JOIN "Budget" b ON b."id" = qf."quoteLayoutId"
  JOIN "Task" t ON t."quoteId" = b."id" JOIN "Implement" i ON i."taskId" = t."id"
  WHERE qf."quoteLayoutId" IS NOT NULL;
  DELETE FROM _m3_q WHERE NOT live AND bstatus IN ('EXPIRED', 'CANCELLED');   -- sem coleta: só o arquivo morto
  DELETE FROM _m3_q WHERE mime = 'application/pdf' AND NOT live;               -- PDF vai ao projeto (5c); com coleta viva fica também como arte
  DELETE FROM _m3_q q USING "Budget" b                                         -- DD6: por veículo, só a cobertura gravada
  WHERE b."id" = q."budgetId" AND b."layoutScope" = 'PER_VEHICLE'
    AND NOT EXISTS (SELECT 1 FROM "BudgetLayoutTask" c WHERE c."fileId" = q."qFileId" AND c."taskId" = q."taskId");
  ALTER TABLE _m3_q ADD COLUMN target "LayoutStatus", ADD COLUMN asrc "LayoutApprovalSource";
  UPDATE _m3_q SET
    target = CASE WHEN bstatus IN ('APPROVED', 'SIGNED') OR live THEN 'APPROVED'::"LayoutStatus"
                  ELSE 'PENDING_APPROVAL'::"LayoutStatus" END,                    -- DD5: pendentes → PENDING_APPROVAL
    asrc   = CASE WHEN bstatus IN ('APPROVED', 'SIGNED') THEN 'MIGRATED_BUDGET'::"LayoutApprovalSource"
                  WHEN live THEN 'MIGRATED_ENVELOPE'::"LayoutApprovalSource" END;
  --    5a. o MESMO File.id já é arte deste implemento (galeria e orçamento com o mesmo arquivo):
  --        sobe para APPROVED quando o alvo é APPROVED; nunca rebaixa um APPROVED da galeria.
  UPDATE "Layout" l SET
    "status" = CASE WHEN q.target = 'APPROVED' OR l."status" = 'APPROVED' THEN 'APPROVED'::"LayoutStatus" ELSE q.target END,
    "approvalSource" = CASE WHEN q.target = 'APPROVED' AND l."status" <> 'APPROVED' THEN q.asrc ELSE l."approvalSource" END,
    "sentAt" = CASE WHEN q.target = 'PENDING_APPROVAL' AND l."status" <> 'APPROVED' THEN coalesce(l."sentAt", now()) ELSE l."sentAt" END
  FROM _m3_q q WHERE l."implementId" = q."implementId" AND l."fileId" = q."qFileId";
  --    5b. M-A: linha nova com o File.id DO ORÇAMENTO (os bytes já são cópia privada). O gêmeo da
  --        galeria (mesmo path ∨ originalName+size, a chave do reconciliador
  --        src/utils/sync-quote-task-layouts.ts) NÃO é tocado aqui.
  --        Unicidade (implementId, fileId) por construção: um File de orçamento pertence a um
  --        orçamento só (quoteLayoutId é escalar), cada tarefa tem um implemento, e o NOT EXISTS
  --        cobre o 5a.
  WITH n AS (
    SELECT q.*, gen_random_uuid()::text AS "newId" FROM _m3_q q
    WHERE NOT EXISTS (SELECT 1 FROM "Layout" l WHERE l."implementId" = q."implementId" AND l."fileId" = q."qFileId")
  ), ins AS (
    INSERT INTO "Layout" ("id", "fileId", "status", "implementId", "approvalSource", "sentAt", "createdAt", "updatedAt")
    SELECT "newId", "qFileId", target, "implementId", asrc,
           CASE WHEN target = 'PENDING_APPROVAL' THEN now() END, now(), now()
    FROM n
    RETURNING "id"
  )
  INSERT INTO "_Mig0924_LayoutOrigin" ("layoutId", "sourceQuoteFileId", "taskId", origin)
  SELECT "newId", "qFileId", "taskId", 'QUOTE' FROM n WHERE "newId" IN (SELECT "id" FROM ins);
  --    5b'. M-B: só onde há coleta RUNNING/COMPLETED — o que não é do orçamento sai de APPROVED.
  CREATE TEMP TABLE _m3_live ON COMMIT DROP AS
  SELECT DISTINCT b."id" AS "budgetId", i."id" AS "implementId"
  FROM "Budget" b JOIN "Task" t ON t."quoteId" = b."id" JOIN "Implement" i ON i."taskId" = t."id"
  WHERE EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId" = b."id" AND e."status" IN ('RUNNING', 'COMPLETED'));
  CREATE TEMP TABLE _m3_mb ON COMMIT DROP AS
  SELECT DISTINCT l."id" AS "layoutId", l."implementId", lv."budgetId"
  FROM _m3_live lv JOIN "Layout" l ON l."implementId" = lv."implementId"
  WHERE l."status" = 'APPROVED'
    AND NOT EXISTS (SELECT 1 FROM _m3_q q2 WHERE q2."budgetId" = lv."budgetId" AND q2."qFileId" = l."fileId");
  UPDATE "Layout" l SET "status" = 'SUPERSEDED' FROM _m3_mb m WHERE m."layoutId" = l."id";
  INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
  SELECT 'GALLERY_SUPERSEDED_BY_QUOTE', l."fileId", i."taskId", m."budgetId"
  FROM _m3_mb m JOIN "Layout" l ON l."id" = m."layoutId" JOIN "Implement" i ON i."id" = m."implementId";
  --        elo de versão: a arte do orçamento "substitui" o gêmeo; supersedesId é @unique ⇒ um par por lado.
  WITH pairs AS (
    SELECT nl."id" AS new_id, ol."id" AS old_id, ol."createdAt" AS oc
    FROM _m3_q q JOIN "Layout" nl ON nl."implementId" = q."implementId" AND nl."fileId" = q."qFileId"
    JOIN _m3_mb m ON m."implementId" = q."implementId" JOIN "Layout" ol ON ol."id" = m."layoutId"
    JOIN "File" ofl ON ofl."id" = ol."fileId"
    WHERE ofl."path" = q."path" OR lower(btrim(coalesce(ofl."originalName", ofl."filename"))) || '::' || ofl."size" = q.ik
  ), one_new AS (
    SELECT DISTINCT ON (new_id) new_id, old_id FROM pairs ORDER BY new_id, oc DESC
  ), one_old AS (
    SELECT DISTINCT ON (old_id) new_id, old_id FROM one_new ORDER BY old_id, new_id
  )
  UPDATE "Layout" nl SET "supersedesId" = o.old_id
  FROM one_old o WHERE nl."id" = o.new_id AND nl."supersedesId" IS NULL;
  --    5b''. triagem para o dono (perguntas 9 e 10 do v1)
  INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
  SELECT DISTINCT 'QUOTE_ART_APPROVED_BY_LIVE_ENVELOPE', q."qFileId", q."taskId", q."budgetId"
  FROM _m3_q q WHERE q.asrc = 'MIGRATED_ENVELOPE';
  INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
  SELECT DISTINCT 'GALLERY_APPROVED_VS_QUOTE_PENDING', l."fileId", q."taskId", q."budgetId"
  FROM _m3_q q JOIN "Layout" l ON l."implementId" = q."implementId"
  WHERE q.target = 'PENDING_APPROVAL' AND l."status" = 'APPROVED' AND l."fileId" <> q."qFileId";
  --    5c. PDF de orçamento → projeto da tarefa de cada tarefa do orçamento + triagem
  INSERT INTO "_TASK_PROJECT_FILES" ("A", "B")
  SELECT qf."id", t."id" FROM "File" qf JOIN "Budget" b ON b."id" = qf."quoteLayoutId"
  JOIN "Task" t ON t."quoteId" = b."id"
  WHERE qf."mimetype" = 'application/pdf' AND b."status"::text NOT IN ('EXPIRED', 'CANCELLED')
  ON CONFLICT DO NOTHING;
  INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
  SELECT 'QUOTE_PDF', qf."id", NULL, qf."originalName" FROM "File" qf
  WHERE qf."quoteLayoutId" IS NOT NULL AND qf."mimetype" = 'application/pdf';

  -- 6. O.S. DE ARTE EM WAITING_APPROVE: a arte mais recente em DRAFT do implemento passa a
  --    PENDING_APPROVAL (senão o portal não mostra nada para aprovar; a aprovação fecha a O.S.,
  --    DD3); implemento sem arte vai para a triagem.
  UPDATE "Layout" l SET "status" = 'PENDING_APPROVAL', "sentAt" = coalesce(l."sentAt", now())
  FROM (SELECT DISTINCT ON (i."id") l2."id"
        FROM "ServiceOrder" so JOIN "Implement" i ON i."taskId" = so."taskId"
        JOIN "Layout" l2 ON l2."implementId" = i."id"
        WHERE so."type" = 'ARTWORK' AND so."status" = 'WAITING_APPROVE' AND l2."status" = 'DRAFT'
        ORDER BY i."id", l2."createdAt" DESC, l2."id") x
  WHERE l."id" = x."id";
  INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
  SELECT 'OS_WAITING_NO_ART', NULL, so."taskId", so."id"
  FROM "ServiceOrder" so WHERE so."type" = 'ARTWORK' AND so."status" = 'WAITING_APPROVE'
    AND NOT EXISTS (SELECT 1 FROM "Implement" i JOIN "Layout" l ON l."implementId" = i."id"
                    WHERE i."taskId" = so."taskId" AND l."status" IN ('PENDING_APPROVAL', 'APPROVED'));

END IF;
END $m3$;

-- 7. ÓRFÃOS: Layout sem implemento e sem aerografia (inclui as linhas de PDF, que agora vivem em
--    _TASK_PROJECT_FILES). Apaga a LINHA Layout — NUNCA o File. (Na segunda rodada: 0 linhas.)
DELETE FROM "Layout" WHERE "implementId" IS NULL AND "airbrushingId" IS NULL;

-- 8. CONSTRAINTS FINAIS (depois do dado)
ALTER TABLE "Layout" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Layout_implementId_fkey') THEN
    ALTER TABLE "Layout" ADD CONSTRAINT "Layout_implementId_fkey" FOREIGN KEY ("implementId")
      REFERENCES "Implement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Layout_supersedesId_fkey') THEN
    ALTER TABLE "Layout" ADD CONSTRAINT "Layout_supersedesId_fkey" FOREIGN KEY ("supersedesId")
      REFERENCES "Layout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Layout_decidedByResponsibleId_fkey') THEN
    ALTER TABLE "Layout" ADD CONSTRAINT "Layout_decidedByResponsibleId_fkey" FOREIGN KEY ("decidedByResponsibleId")
      REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Layout_decidedByUserId_fkey') THEN
    ALTER TABLE "Layout" ADD CONSTRAINT "Layout_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId")
      REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Layout_one_owner_check') THEN
    ALTER TABLE "Layout" ADD CONSTRAINT "Layout_one_owner_check"
      CHECK (("implementId" IS NOT NULL) <> ("airbrushingId" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Layout_decision_note_check') THEN
    -- motivo obrigatório na reprovação PELO PORTAL; a regra de serviço também exige nota em
    -- ON_BEHALF, mas as linhas migradas não têm nota, por isso não vira CHECK geral.
    ALTER TABLE "Layout" ADD CONSTRAINT "Layout_decision_note_check"
      CHECK ("status" <> 'REPROVED' OR "approvalSource" IS DISTINCT FROM 'PORTAL' OR "decisionNote" IS NOT NULL);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Layout_implementId_fileId_key"   ON "Layout"("implementId", "fileId");
CREATE UNIQUE INDEX IF NOT EXISTS "Layout_airbrushingId_fileId_key" ON "Layout"("airbrushingId", "fileId");
CREATE UNIQUE INDEX IF NOT EXISTS "Layout_supersedesId_key"         ON "Layout"("supersedesId");
CREATE INDEX        IF NOT EXISTS "Layout_implementId_status_idx"   ON "Layout"("implementId", "status");
-- trilha: uma linha de decisão para cada arte migrada já decidida (as SUPERSEDED do M-B guardam
-- approvalSource = MIGRATED_TASK e ganham aqui a decisão toStatus = SUPERSEDED; o porquê está na
-- triagem GALLERY_SUPERSEDED_BY_QUOTE). WHERE NOT EXISTS: a segunda rodada não duplica.
INSERT INTO "LayoutDecision" ("id", "layoutId", "toStatus", "source", "createdAt")
SELECT gen_random_uuid()::text, l."id", l."status", l."approvalSource", now()
FROM "Layout" l
WHERE l."approvalSource" IN ('MIGRATED_TASK', 'MIGRATED_BUDGET', 'MIGRATED_ENVELOPE')
  AND NOT EXISTS (SELECT 1 FROM "LayoutDecision" d WHERE d."layoutId" = l."id");

-- 9. O M2M morre (o arquivo morto do passo 0 guarda tudo)
DROP TABLE IF EXISTS "_TaskLayouts";

-- Reversão: recriar "_TaskLayouts" a partir de "_Mig0924_TaskLayouts"; DELETE FROM "Layout" WHERE id IN
-- (SELECT "layoutId" FROM "_Mig0924_LayoutOrigin"); restaurar status/implementId = NULL das linhas
-- originais (as SUPERSEDED do M-B voltam a APPROVED) e reinserir as órfãs a partir de "_Mig0924_Layout";
-- "_TASK_PROJECT_FILES" := "_Mig0924_TaskProjectFiles"; esvaziar "_IMPLEMENT_PROJECT_FILES" (a tabela é
-- da M2); DROP TABLE "LayoutDecision"; recriar "Layout_fileId_key" (só depois de apagar o fan-out);
-- DELETE FROM "Implement" WHERE id IN (SELECT "implementId" FROM "_Mig0924_ImplementCreated").
