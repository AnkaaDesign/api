-- G25 — OBJETOS DE BANCO DA R-B QUE `prisma db push` NÃO CRIA (escrito no P10, 23/09).
--
-- É o que prisma/sql/objetos-pos-push.sql passa a ter depois de cada fatia da R-B, separado por
-- fatia. Quem PROMOVE a fatia (P11a: M1+M1s; P11b: M2; P12: M3; P14: M3o-a e M3o-b) NÃO cola este
-- texto à mão no arquivo canônico (ele é GERADO): aplica a fatia no ankaa_implemento
-- (`prisma migrate deploy`) e REGERA o canônico com `npx tsx scripts/gen-objetos-pos-push.ts`.
-- Este arquivo serve para (1) dizer o que tem de aparecer no canônico regerado — cada nome abaixo —
-- e (2) o ensaio da R-B conferir, depois de aplicar cada fatia, que cada objeto do bloco dela
-- existe no catálogo (scripts/rehearse-implement-migration.ts, "G25 da R-B").
--
-- Mesma forma do gerador (DROP … IF EXISTS + CREATE), idempotente. NUNCA rodar em produção (lá
-- tudo vem das migrations). Blocos na ordem das fatias; cada bloco só vale depois da fatia dele.

BEGIN;

-- ════ M1 (20260930120000_truck_vira_implement) ════
-- As colunas geradas da busca sem acento acompanham o RENAME: no canônico, "Truck" vira "Implement".
ALTER TABLE "Implement" DROP COLUMN IF EXISTS "chassisNumberNormalized";
ALTER TABLE "Implement" ADD COLUMN "chassisNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("chassisNumber"))) STORED;
ALTER TABLE "Implement" DROP COLUMN IF EXISTS "plateNormalized";
ALTER TABLE "Implement" ADD COLUMN "plateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(plate))) STORED;

-- ════ M1s (20260930120050_serie_no_implemento_e_implemento_obrigatorio) ════
-- O espelho Implement → Task.serialNumber e a guarda dele nascem na M1s e caem na M5s
-- (20260930120070_serie_so_no_implemento), na MESMA release (decisão de 25/09): o estado final
-- não os tem, então não entram aqui.

CREATE OR REPLACE FUNCTION public.task_must_have_implement()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE tid text;
BEGIN
  IF TG_TABLE_NAME = 'Task' THEN
    tid := NEW."id";
  ELSE
    tid := OLD."taskId";
  END IF;
  IF EXISTS (SELECT 1 FROM "Task" WHERE "id" = tid)
     AND NOT EXISTS (SELECT 1 FROM "Implement" WHERE "taskId" = tid) THEN
    RAISE EXCEPTION 'Tarefa % sem implemento: toda tarefa tem exatamente um implemento', tid
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $function$;

ALTER TABLE "Implement" DROP COLUMN IF EXISTS "serialNumberNormalized";
ALTER TABLE "Implement" ADD COLUMN "serialNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("serialNumber"))) STORED;
CREATE INDEX IF NOT EXISTS "Implement_serialNumberNormalized_trgm_idx" ON public."Implement" USING gin ("serialNumberNormalized" gin_trgm_ops);

DROP TRIGGER IF EXISTS "Task_has_implement" ON "Task";
CREATE CONSTRAINT TRIGGER "Task_has_implement" AFTER INSERT ON public."Task" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();
DROP TRIGGER IF EXISTS "Implement_keeps_task_covered" ON "Implement";
CREATE CONSTRAINT TRIGGER "Implement_keeps_task_covered" AFTER DELETE OR UPDATE OF "taskId" ON public."Implement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();

-- ════ Mnom (20260930120060_implemento_nomenclatura_completa) ════
-- Só renomeia tipo, valor de enum e dados: nenhum objeto novo.

-- ════ M5s (20260930120070_serie_so_no_implemento) ════
-- Só remove (a coluna-espelho da tarefa, a gerada e o GIN dela, o espelho e a guarda).

-- ════ M2 (20260930120100_implemento_frente_e_porta_traseira) ════
ALTER TABLE "Implement" DROP CONSTRAINT IF EXISTS "Implement_rearDoorBarCount_check";
ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorBarCount_check" CHECK ((("rearDoorBarCount" IS NULL) OR ("rearDoorBarCount" = ANY (ARRAY[2, 3, 4]))));
ALTER TABLE "Implement" DROP CONSTRAINT IF EXISTS "Implement_rearDoorHatchCount_check";
ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorHatchCount_check" CHECK ((("rearDoorHatchCount" IS NULL) OR (("rearDoorHatchCount" >= 0) AND ("rearDoorHatchCount" <= 6))));

-- ════ M3 (20260930120200_arte_do_implemento_e_projeto_da_tarefa) ════
ALTER TABLE "Layout" DROP CONSTRAINT IF EXISTS "Layout_one_owner_check";
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_one_owner_check" CHECK ((("implementId" IS NOT NULL) <> ("airbrushingId" IS NOT NULL)));
ALTER TABLE "Layout" DROP CONSTRAINT IF EXISTS "Layout_decision_note_check";
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_decision_note_check" CHECK (((status <> 'REPROVED'::"LayoutStatus") OR ("approvalSource" IS DISTINCT FROM 'PORTAL'::"LayoutApprovalSource") OR ("decisionNote" IS NOT NULL)));

-- ════ M3o-a (20260930120300_orcamento_eixo_da_assinatura) ════
ALTER TABLE "BudgetValueApproval" DROP CONSTRAINT IF EXISTS "BudgetValueApproval_note_check";
ALTER TABLE "BudgetValueApproval" ADD CONSTRAINT "BudgetValueApproval_note_check" CHECK (((source <> 'ON_BEHALF'::"BudgetValueApprovalSource") OR (note IS NOT NULL)));
ALTER TABLE "BudgetValueApproval" DROP CONSTRAINT IF EXISTS "BudgetValueApproval_actor_check";
ALTER TABLE "BudgetValueApproval" ADD CONSTRAINT "BudgetValueApproval_actor_check" CHECK ((NOT (("responsibleId" IS NOT NULL) AND ("userId" IS NOT NULL))));
ALTER TABLE "BudgetOfflineSignature" DROP CONSTRAINT IF EXISTS "BudgetOfflineSignature_note_check";
ALTER TABLE "BudgetOfflineSignature" ADD CONSTRAINT "BudgetOfflineSignature_note_check" CHECK ((length(btrim(note)) > 0));

-- ════ M3o-b (20260930120350_orcamento_valor_aprovado) ════
-- A fila recriada: no canônico, a expressão de "queueRank" muda (EXPIRED e PENDING trocam de grupo).
ALTER TABLE "Budget" DROP COLUMN IF EXISTS "queueRank";
ALTER TABLE "Budget" ADD COLUMN "queueRank" double precision GENERATED ALWAYS AS (
CASE
    WHEN (status = ANY (ARRAY['REQUESTED'::"BudgetStatus", 'EXPIRED'::"BudgetStatus", 'PENDING'::"BudgetStatus", 'APPROVED'::"BudgetStatus", 'SIGNED'::"BudgetStatus", 'CANCELLED'::"BudgetStatus"])) THEN (- EXTRACT(epoch FROM "createdAt"))
    ELSE EXTRACT(epoch FROM "createdAt")
END) STORED;
CREATE INDEX IF NOT EXISTS "Budget_statusOrder_queueRank_idx" ON public."Budget" USING btree ("statusOrder", "queueRank");

COMMIT;
