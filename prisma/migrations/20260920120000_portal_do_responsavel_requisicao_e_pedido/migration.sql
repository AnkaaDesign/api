-- PORTAL DO RESPONSÁVEL: a requisição de orçamento, a pré-aprovação do vendedor e
-- o pedido de compra viram DADO.
--
-- ============================================================================
-- POR QUÊ
-- ============================================================================
--
-- O portal do cliente autentica desde 17/09 e não serve nada: quatro rotas, todas
-- de auth. Esta migration abre o caminho para ele SERVIR — e, ao fazê-lo, corrige
-- três coisas que já estavam tortas por dentro.
--
-- 1. O ORÇAMENTO NÃO SABE DIZER QUEM ESTÁ DEVENDO O QUÊ.
--    `PENDING` significa hoje, ao mesmo tempo, "o comercial ainda não precificou"
--    e "o cliente ainda não assinou". São dois donos e dois relógios na mesma
--    palavra. Entram `REQUESTED` (a Ankaa deve um preço), `IN_NEGOTIATION` (o
--    vendedor do cliente deve uma decisão) e `PRE_APPROVED` (a Ankaa deve lançar
--    as assinaturas). `PENDING` FICA — só o rótulo passa a ser "Aguardando
--    Assinatura", porque o VALOR viaja para fora da API em filtro salvo, no app
--    Flutter em produção e em changelog gravado como string.
--
-- 2. "EM NEGOCIAÇÃO" NUNCA FOI UM ESTADO — era uma `description` de TEXTO LIVRE
--    de uma `ServiceOrder` comercial, comparada em três arquivos com três
--    normalizações diferentes, e que aprovava o orçamento quando concluída e o
--    REBAIXAVA de APPROVED para PENDING quando reaberta. Produção prova a
--    fragilidade: das 486 linhas, 19 estão grafadas "Em Negociacao" (sem cedilha
--    nem til) e 1 como "NEGOCIACAO" — e a comparação do web é sensível a caixa E
--    acento, logo essas 20 já eram invisíveis para ela. Sai a O.S.; o andar da
--    negociação passa a ser `Budget.status`, que é onde ele sempre deveria estar.
--
-- 3. O PEDIDO DE COMPRA ERA TEXTO SOLTO POR VEÍCULO. `Task.customerOrderNumber`
--    é livre e não único, e "os 20 primeiros no pedido 8842" só se respondia
--    reconstruindo a string. Nasce `PurchaseOrder`, desenhada em
--    `docs/REESTRUTURACAO_ORCAMENTO_FATURAMENTO.md` §2.12 e nunca construída.
--    A coluna antiga PERMANECE: é ela que a regra de atenção
--    `budget.ibipora-missing-order-number`, a NFS-e e o `seuNumero` do boleto
--    leem hoje.
--
-- ============================================================================
-- O QUE PRODUÇÃO DIZ, ANTES DE QUALQUER DDL DESTRUTIVO
-- ============================================================================
--
--   SELECT status, "statusOrder", count(*) FROM "Budget" GROUP BY 1,2 ORDER BY 2;
--     EXPIRED    1     6
--     PENDING    3   158
--     APPROVED   4   429
--     CANCELLED  5     1                                    -- total 594
--     (nenhuma linha em SIGNED; nenhuma em statusOrder 2)
--
--   SELECT count(*), count(*) FILTER (WHERE status NOT IN ('COMPLETED','CANCELLED')),
--          count(DISTINCT "taskId")
--     FROM "ServiceOrder" WHERE type='COMMERCIAL'
--      AND lower(translate(trim(description),'ãáàâçéêíóôõú','aaaaceeiooou'))
--          IN ('em negociacao','negociacao');
--     total 486 · abertas 120 · tarefas distintas 486
--     → UMA por tarefa. É a O.S. padrão de toda tarefa, não um registro de trabalho.
--
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE confrelid='"ServiceOrder"'::regclass AND contype='f';
--     _SERVICE_ORDER_CHECKIN_FILES_B_fkey   c (CASCADE)
--     _SERVICE_ORDER_CHECKOUT_FILES_B_fkey  c (CASCADE)
--     → NADA depende de uma O.S. a não ser os vínculos de arquivo, ambos CASCADE.
--       Apagar as 486 não deixa órfão nem viola restrição.
--
--   SELECT count(*), count(*) FILTER (WHERE "userId" IS NULL) FROM "Notification";
--     2807 · 0        → o CHECK de destinatário único passa sem exceção.
--
--   SELECT count(*), count(DISTINCT "customerOrderNumber") FROM "Task"
--    WHERE "customerOrderNumber" IS NOT NULL AND trim("customerOrderNumber") <> '';
--     18 linhas · 9 números distintos   → backfill pequeno e conferível à mão.
--
-- ⚠️ ESTA MIGRATION APAGA 486 LINHAS DE `ServiceOrder`. Faça dump antes.
--
-- ⚠️ NÃO remove a O.S. comercial "Enviar Orçamento" (1.703 linhas) nem as outras
--    do tipo COMMERCIAL. O tipo continua vivo e em uso; o que sai é UMA descrição.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. `BudgetStatus`: três valores novos, e o tipo RECRIADO na ordem de atenção.
-- ----------------------------------------------------------------------------
--
-- O Postgres não insere valor no meio de um enum, e aqui a ORDEM DE DECLARAÇÃO é
-- semântica (primeiro o que a Ankaa deve, depois o que o cliente deve, por último
-- os terminais). Recriar é a única forma de conseguir as duas coisas — mesmo
-- caminho de `20260901120000_responsible_role_purchasing`.
--
-- ⚠️ `Budget.queueRank` é coluna GERADA que MENCIONA este tipo
--    (`status IN ('APPROVED','CANCELLED')`). Uma coluna gerada bloqueia o
--    `ALTER COLUMN ... TYPE`, então ela e o índice dela caem antes e voltam
--    depois, idênticos. Sem isso a migration falha no meio, com o tipo já trocado.

DROP INDEX IF EXISTS "Budget_statusOrder_queueRank_idx";
ALTER TABLE "Budget" DROP COLUMN IF EXISTS "queueRank";

ALTER TABLE "Budget" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Budget" ALTER COLUMN "status" TYPE text USING "status"::text;

DROP TYPE "BudgetStatus";
CREATE TYPE "BudgetStatus" AS ENUM (
  'REQUESTED',
  'EXPIRED',
  'PRE_APPROVED',
  'SIGNED',
  'IN_NEGOTIATION',
  'PENDING',
  'APPROVED',
  'CANCELLED'
);

ALTER TABLE "Budget" ALTER COLUMN "status" TYPE "BudgetStatus" USING "status"::"BudgetStatus";
ALTER TABLE "Budget" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Idêntica à de `20260917210000_fila_do_orcamento`. `REQUESTED`, `IN_NEGOTIATION`
-- e `PRE_APPROVED` NÃO são terminais: entram no ramo ELSE e ordenam do mais antigo
-- primeiro, que é o que a fila quer — requisição esquecida é a mais urgente.
ALTER TABLE "Budget" ADD COLUMN "queueRank" double precision
  GENERATED ALWAYS AS (
    CASE
      WHEN "status" IN ('APPROVED', 'CANCELLED') THEN -extract(epoch from "createdAt")
      ELSE extract(epoch from "createdAt")
    END
  ) STORED;

CREATE INDEX "Budget_statusOrder_queueRank_idx" ON "Budget" ("statusOrder", "queueRank");

-- ----------------------------------------------------------------------------
-- 2. Backfill de `statusOrder`.
-- ----------------------------------------------------------------------------
--
-- `statusOrder` é PERSISTIDO e a lista ordena e pagina por ele no servidor. Sem
-- este passo as 594 linhas ficam com a numeração velha e a tela sai fora de ordem
-- em silêncio — nada falha, só mente. Precedentes: `20260911160000` e
-- `20260916233000`.
--
-- ⚠️ Escrito por extenso, e não por um mapa em código, porque o valor tem de
--    casar com `BUDGET_STATUS_ORDER` (`src/constants/sortOrders.ts`) EXATAMENTE.
--    Duas fontes, um número: se divergirem, a ordenação do servidor e a do
--    cliente discordam.

UPDATE "Budget" SET "statusOrder" = CASE "status"
  WHEN 'REQUESTED'      THEN 1
  WHEN 'EXPIRED'        THEN 2
  WHEN 'PRE_APPROVED'   THEN 3
  WHEN 'SIGNED'         THEN 4
  WHEN 'IN_NEGOTIATION' THEN 5
  WHEN 'PENDING'        THEN 6
  WHEN 'APPROVED'       THEN 7
  WHEN 'CANCELLED'      THEN 8
END;

ALTER TABLE "Budget" ALTER COLUMN "statusOrder" SET DEFAULT 6;

-- ----------------------------------------------------------------------------
-- 3. `BudgetRequest` — o pedido do cliente, antes de existir preço.
-- ----------------------------------------------------------------------------
--
-- Fora de `Budget` de propósito: o que mora em `Budget` corre risco de entrar na
-- projeção material da assinatura e derrubar coleta em curso. Briefing e nome de
-- logomarca são conversa comercial, não cláusula do instrumento.

CREATE TABLE "BudgetRequest" (
  "id"                         TEXT         NOT NULL,
  "budgetId"                   TEXT         NOT NULL,
  "requestedByResponsibleId"   TEXT         NOT NULL,
  "requestedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "briefing"                   TEXT         NOT NULL,
  "logoName"                   TEXT,
  "preApprovedAt"              TIMESTAMP(3),
  "preApprovedByResponsibleId" TEXT,
  "refusedAt"                  TIMESTAMP(3),
  "refusedByResponsibleId"     TEXT,
  "decisionNote"               TEXT,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BudgetRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BudgetRequest_budgetId_key" ON "BudgetRequest"("budgetId");
CREATE INDEX "BudgetRequest_requestedByResponsibleId_idx" ON "BudgetRequest"("requestedByResponsibleId");
CREATE INDEX "BudgetRequest_requestedAt_idx" ON "BudgetRequest"("requestedAt");

ALTER TABLE "BudgetRequest"
  ADD CONSTRAINT "BudgetRequest_budgetId_fkey"
  FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: apagar um contato não pode apagar o pedido que originou um contrato.
ALTER TABLE "BudgetRequest"
  ADD CONSTRAINT "BudgetRequest_requestedByResponsibleId_fkey"
  FOREIGN KEY ("requestedByResponsibleId") REFERENCES "Representative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BudgetRequest"
  ADD CONSTRAINT "BudgetRequest_preApprovedByResponsibleId_fkey"
  FOREIGN KEY ("preApprovedByResponsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BudgetRequest"
  ADD CONSTRAINT "BudgetRequest_refusedByResponsibleId_fkey"
  FOREIGN KEY ("refusedByResponsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pré-aprovado E recusado ao mesmo tempo é estado impossível. O banco recusa.
ALTER TABLE "BudgetRequest"
  ADD CONSTRAINT "BudgetRequest_decisao_unica"
  CHECK ("preApprovedAt" IS NULL OR "refusedAt" IS NULL);

-- ----------------------------------------------------------------------------
-- 4. `PurchaseOrder` — o pedido de compra do cliente.
-- ----------------------------------------------------------------------------

CREATE TABLE "PurchaseOrder" (
  "id"                    TEXT         NOT NULL,
  "customerId"            TEXT         NOT NULL,
  "number"                TEXT         NOT NULL,
  "issuedAt"              TIMESTAMP(3),
  "issuedByResponsibleId" TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- Único DENTRO do cliente que o emitiu: dois clientes têm pedido "1" sem conflito.
CREATE UNIQUE INDEX "PurchaseOrder_customerId_number_key" ON "PurchaseOrder"("customerId", "number");
CREATE INDEX "PurchaseOrder_customerId_idx" ON "PurchaseOrder"("customerId");
CREATE INDEX "PurchaseOrder_issuedByResponsibleId_idx" ON "PurchaseOrder"("issuedByResponsibleId");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_issuedByResponsibleId_fkey"
  FOREIGN KEY ("issuedByResponsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task" ADD COLUMN "purchaseOrderId" TEXT;
CREATE INDEX "Task_purchaseOrderId_idx" ON "Task"("purchaseOrderId");

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: 18 tarefas, 9 números. O pedido pertence ao cliente DA TAREFA; tarefa
-- sem cliente não gera pedido (não há a quem pertencer). `DISTINCT ON` porque o
-- mesmo par (cliente, número) aparece em vários veículos — que é justamente o
-- caso legítimo que a coluna antiga não sabia representar.
INSERT INTO "PurchaseOrder" ("id", "customerId", "number", "createdAt", "updatedAt")
SELECT DISTINCT ON (t."customerId", trim(t."customerOrderNumber"))
       gen_random_uuid()::text,
       t."customerId",
       trim(t."customerOrderNumber"),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
  FROM "Task" t
 WHERE t."customerOrderNumber" IS NOT NULL
   AND trim(t."customerOrderNumber") <> ''
   AND t."customerId" IS NOT NULL;

UPDATE "Task" t
   SET "purchaseOrderId" = po."id"
  FROM "PurchaseOrder" po
 WHERE po."customerId" = t."customerId"
   AND po."number" = trim(t."customerOrderNumber")
   AND t."customerOrderNumber" IS NOT NULL
   AND trim(t."customerOrderNumber") <> '';

-- ----------------------------------------------------------------------------
-- 5. `Notification.responsibleId` — passa a ser possível avisar um CLIENTE.
-- ----------------------------------------------------------------------------
--
-- Até aqui `userId` era a única FK de pessoa e `getTargetUsers` só resolvia
-- `prisma.user`. Um fluxo com passagem de bastão entre vendedor, compras e
-- comercial não tinha como avisar ninguém do outro lado.
--
-- CHECK de destinatário único, mesma doutrina do
-- `EnvelopeSigner_exactly_one_identity`: os dois sujeitos não se misturam, e o
-- banco é quem garante.
--
-- A conta de "0 linhas com `userId` nulo" não se sustentou contra o backup de
-- 21/09: há 6 avisos de ponto ("Hora de Registrar o Ponto" / "Lembrete de
-- Ponto") criados em 27/08 num intervalo de quatro segundos, todos sem
-- destinatário nenhum. Como o `ALTER TABLE ... ADD CONSTRAINT` valida a tabela
-- INTEIRA, essas 6 linhas derrubam o CHECK com 23514 e levam a migration toda
-- junto — foi o que aconteceu ao restaurar produção.
--
-- Elas são varridas, não backfilladas: aviso sem dono não tem a quem ser
-- entregue nem tela onde aparecer, e só existiu porque não havia CHECK.

ALTER TABLE "Notification" ADD COLUMN "responsibleId" TEXT;
CREATE INDEX "Notification_responsibleId_idx" ON "Notification"("responsibleId");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_responsibleId_fkey"
  FOREIGN KEY ("responsibleId") REFERENCES "Representative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DELETE FROM "Notification"
 WHERE "userId" IS NULL AND "responsibleId" IS NULL;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_exactly_one_recipient"
  CHECK (("userId" IS NULL) <> ("responsibleId" IS NULL));

-- ----------------------------------------------------------------------------
-- 6. `SignatureAuthMethod.RESPONSIBLE_SESSION`.
-- ----------------------------------------------------------------------------
--
-- Valor PRÓPRIO, e não reuso de `INTERNAL_SESSION`: `ceremonyKindOf` é um ternário
-- de uma linha com quatro dependentes, e dar `INTERNAL_SESSION` a um signatário do
-- CLIENTE faria os quatro virarem comportamento do lado Ankaa, em silêncio.
--
-- Vai no FIM do enum: aqui a ordem não carrega semântica (ao contrário de
-- `BudgetStatus` e `ResponsibleRole`), então acrescentar não exige recriar o tipo.

ALTER TYPE "SignatureAuthMethod" ADD VALUE IF NOT EXISTS 'RESPONSIBLE_SESSION';

-- ----------------------------------------------------------------------------
-- 7. A O.S. "Em Negociação" sai.
-- ----------------------------------------------------------------------------
--
-- 486 linhas, uma por tarefa, 120 abertas. Não registram trabalho: registram em
-- que ponto da negociação o orçamento está — que agora é `Budget.status`, com
-- máquina de transições, changelog e portão de papel, nenhum dos quais uma string
-- de descrição jamais teve.
--
-- As 120 abertas são também a razão pela qual isto não pode ficar para depois:
-- `Task → COMPLETED` exige TODA O.S. concluída ou cancelada, então cada uma delas
-- é um veículo que não fecha por causa de uma linha de controle comercial.
--
-- `translate` cobre as três grafias que produção tem ("Em Negociação",
-- "Em Negociacao", "NEGOCIACAO") — a comparação do web era sensível a caixa e
-- acento e já não enxergava 20 delas.

DELETE FROM "ServiceOrder"
 WHERE "type" = 'COMMERCIAL'
   AND lower(translate(trim("description"), 'ãáàâçéêíóôõú', 'aaaaceeiooou'))
       IN ('em negociacao', 'negociacao');
