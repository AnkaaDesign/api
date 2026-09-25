-- M3o-b — o eixo do valor: APPROVED passa a ser "valor aprovado" e PRE_APPROVED sai (release R-B;
-- DD2 Modelo C, DD7, DD8; PLANO §2A.3, §2A.10, §3.1, §3.2, §3.3, §4.3 passos 3 em diante).
--
-- FATIA ESCRITA E ENSAIADA NO P10, PROMOVIDA PELO P14 NO FIM DO PACOTE (protocolo do §4.1), junto
-- com os espelhos TS do enum (src/constants/enums.ts, sortOrders.ts, schemas/budget.ts, rótulos):
-- o código velho escreve PENDING na emissão e lê PRE_APPROVED.
-- Blocos do esquema-alvo que esta fatia traz:
--   · enum BudgetStatus recriado: REQUESTED, EXPIRED, PENDING, IN_NEGOTIATION, APPROVED, SIGNED (legado),
--     CANCELLED — sem PRE_APPROVED, na ordem de atenção nova;
--   · Budget.statusOrder @default(3) (X8: o schema dizia 1 e o banco 6); o comentário de Budget.queueRank.
-- Objetos de banco (G25; bloco "M3o-b" de objetos-pos-push.r-b.sql): a coluna gerada "Budget"."queueRank"
-- com a expressão nova e o índice "Budget_statusOrder_queueRank_idx".
--
-- Precedente do caminho DROP/CREATE do tipo com a coluna gerada: 20260920120000…/migration.sql:79-124
-- (as duas migrações que criaram o tipo de 8 valores e a fila híbrida NÃO se editam; esta recria por cima).
-- Sem hash (DD8): não há script pós-migração.
-- Idempotente (§4.5): tudo roda dentro de um bloco que só entra enquanto o tipo ainda tem
-- 'PRE_APPROVED' (isto é, antes de recriá-lo). A segunda rodada não faz nada.
-- Pré-condição: M3o-a ("signatureStatus", "BudgetValueApproval", "_Mig0924_Triage").

DO $m3ob$
DECLARE outras text;
BEGIN
IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'BudgetStatus' AND e.enumlabel = 'PRE_APPROVED') THEN

  -- Toda coluna do tipo fora de "Budget"."status" precisaria do mesmo ALTER … TYPE text / volta, senão o
  -- DROP TYPE falha. Conferido no clone (23/09): nenhuma. Falha ALTO se aparecer alguma.
  SELECT string_agg(format('%I.%I', c.table_name, c.column_name), ', ') INTO outras
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.udt_name = 'BudgetStatus'
    AND NOT (c.table_name = 'Budget' AND c.column_name = 'status');
  IF outras IS NOT NULL THEN
    RAISE EXCEPTION 'M3o-b: colunas do tipo "BudgetStatus" fora de Budget.status: % — trate cada uma antes', outras;
  END IF;

  -- 3. EIXO DO VALOR: resíduos (§2A.10), ANTES de recriar o tipo
  --    REQUESTED com coleta RUNNING (clone: 9, seed) → PENDING (coleta LEGADA: a conclusão aprova, como hoje)
  UPDATE "Budget" SET "status" = 'PENDING'
  WHERE "status"::text = 'REQUESTED' AND "signatureStatus" IN ('AWAITING_CUSTOMER', 'AWAITING_ANKAA');
  --    PENDING cuja coleta vigente venceu ou foi recusada → EXPIRED ("Aguardando Reanálise")
  UPDATE "Budget" SET "status" = 'EXPIRED'
  WHERE "status"::text = 'PENDING' AND "signatureStatus" IN ('REFUSED', 'EXPIRED');
  --    PENDING com coleta legada CONCLUÍDA que não aprovou (o gancho de conclusão esbarrou no portão
  --    de layout — o "nº 591"): vira APPROVED, que é o que budgetApprove teria feito; ganha a
  --    aprovação MIGRATED no passo 4 e vai à triagem. Clone: 1 (nº 591, dado de teste).
  INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
  SELECT 'LEGACY_COMPLETED_NOT_APPROVED', NULL, NULL, "id"
  FROM "Budget" WHERE "status"::text = 'PENDING' AND "signatureStatus" = 'SIGNED';
  UPDATE "Budget" SET "status" = 'APPROVED'
  WHERE "status"::text = 'PENDING' AND "signatureStatus" = 'SIGNED';
  --    SIGNED (grupo 0 completo, falta a Ankaa; clone: 0) → APPROVED + AWAITING_ANKAA
  UPDATE "Budget" SET "status" = 'APPROVED', "signatureStatus" = 'AWAITING_ANKAA'
  WHERE "status"::text = 'SIGNED';

  -- 4. APROVAÇÃO DO VALOR para quem já está aprovado: o registro que o E1 e o portal leem.
  --    PRE_APPROVED (clone: 0) leva o autor da pré-aprovação do portal (BudgetRequest.preApprovedBy).
  INSERT INTO "BudgetValueApproval" ("id", "budgetId", "source", "responsibleId", "decidedAt")
  SELECT gen_random_uuid()::text, b."id", 'MIGRATED',
         CASE WHEN b."status"::text = 'PRE_APPROVED' THEN r."preApprovedByResponsibleId" END,
         coalesce(r."preApprovedAt", b."updatedAt")
  FROM "Budget" b LEFT JOIN "BudgetRequest" r ON r."budgetId" = b."id"
  WHERE b."status"::text IN ('APPROVED', 'PRE_APPROVED')
    AND NOT EXISTS (SELECT 1 FROM "BudgetValueApproval" v WHERE v."budgetId" = b."id" AND v."revokedAt" IS NULL);

  -- 5. O TIPO SEM PRE_APPROVED (e SIGNED no fim, como legado). queueRank cai e volta: uma coluna
  --    gerada que cita valores do enum não aceita ALTER … USING.
  UPDATE "Budget" SET "status" = 'APPROVED' WHERE "status"::text = 'PRE_APPROVED';
  DROP INDEX IF EXISTS "Budget_statusOrder_queueRank_idx";
  ALTER TABLE "Budget" DROP COLUMN IF EXISTS "queueRank";
  ALTER TABLE "Budget" ALTER COLUMN "status" DROP DEFAULT;
  ALTER TABLE "Budget" ALTER COLUMN "status" TYPE text USING "status"::text;
  DROP TYPE "BudgetStatus";
  CREATE TYPE "BudgetStatus" AS ENUM
    ('REQUESTED', 'EXPIRED', 'PENDING', 'IN_NEGOTIATION', 'APPROVED', 'SIGNED', 'CANCELLED');
  ALTER TABLE "Budget" ALTER COLUMN "status" TYPE "BudgetStatus" USING "status"::"BudgetStatus";
  ALTER TABLE "Budget" ALTER COLUMN "status" SET DEFAULT 'PENDING';
  -- A FILA (§2A.3): mais recente primeiro quando a bola está com a Ankaa ou o orçamento terminou;
  -- mais antigo primeiro quando se espera o cliente (IN_NEGOTIATION). EXPIRED e PENDING mudam de grupo.
  ALTER TABLE "Budget" ADD COLUMN "queueRank" double precision
    GENERATED ALWAYS AS (
      CASE
        WHEN "status" IN ('REQUESTED', 'EXPIRED', 'PENDING', 'APPROVED', 'SIGNED', 'CANCELLED')
          THEN -extract(epoch FROM "createdAt")
        ELSE extract(epoch FROM "createdAt")
      END) STORED;
  CREATE INDEX "Budget_statusOrder_queueRank_idx" ON "Budget" ("statusOrder", "queueRank");

  -- 6. statusOrder POR EXTENSO. Tem de casar EXATAMENTE com BUDGET_STATUS_ORDER em
  --    src/constants/sortOrders.ts e web/src/constants/sortOrders.ts (duas fontes, um número; G26),
  --    que o P14 muda no mesmo commit da promoção.
  UPDATE "Budget" SET "statusOrder" = CASE "status"
    WHEN 'REQUESTED' THEN 1 WHEN 'EXPIRED' THEN 2 WHEN 'PENDING' THEN 3 WHEN 'IN_NEGOTIATION' THEN 4
    WHEN 'APPROVED' THEN 5 WHEN 'SIGNED' THEN 5 WHEN 'CANCELLED' THEN 6 END;
  ALTER TABLE "Budget" ALTER COLUMN "statusOrder" SET DEFAULT 3;

END IF;
END $m3ob$;

-- Reversão: a partir de "_Mig0924_BudgetStatus" (status e statusOrder), recriar o tipo de 8 valores
-- (20260920120000…:97-107) e o queueRank de 20260920190000; apagar as BudgetValueApproval MIGRATED.
-- A M3o-a se reverte à parte.
