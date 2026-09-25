-- M3o-a — o eixo da assinatura do orçamento (release R-B; DD2 Modelo C, DD7, DD8, DD11;
-- PLANO §2A.4, §2A.10, §3.1, §3.3, §4.3 passos 0–2).
--
-- FATIA ESCRITA E ENSAIADA NO P10, PROMOVIDA PELO P14 NO "COMMIT ZERO" DO PAR [P14 ∥ P13b]
-- (protocolo do §4.1). ADITIVA: o código velho ignora coluna e tabela novas.
-- Blocos do esquema-alvo que esta fatia traz:
--   · Budget.signatureStatus (BudgetSignatureStatus @default(NOT_ISSUED)) + @@index;
--     Budget.valueApprovals, Budget.offlineSignatures;
--   · model BudgetValueApproval, model BudgetOfflineSignature;
--   · enum BudgetSignatureStatus (com SIGNED_OFFLINE, DD11), enum BudgetValueApprovalSource;
--   · File.budgetOfflineSignatures; Responsible.valueApprovals; User.valueApprovals, User.offlineSignatures.
-- Objetos de banco (G25; bloco "M3o-a" de objetos-pos-push.r-b.sql): 3 CHECKs.
--
-- Sem hash dos termos (DD8). WAIVED só nasce aqui e na conciliação (DD7; sem ato de tela).
-- SIGNED_OFFLINE nasce vazio: nenhum orçamento migra para ele (é o ato "Assinado fora do sistema", P14).
-- Idempotência (§4.5): CREATE TYPE / CREATE TABLE / índices guardados; o cálculo do eixo e a triagem
-- só rodam quando a coluna "signatureStatus" nasce (a segunda rodada não pisa no que o P14 escreveu).
-- Pré-condição: M3 (tabela "_Mig0924_Triage"; recriada aqui por segurança).

-- 0. ARQUIVO MORTO
CREATE TABLE IF NOT EXISTS "_Mig0924_BudgetStatus" AS
  SELECT "id", "status"::text AS status, "statusOrder" FROM "Budget";
CREATE TABLE IF NOT EXISTS "_Mig0924_Triage" (kind text, "fileId" text, "taskId" text, note text);

-- 1. TIPOS E TABELAS NOVOS (tipo criado pode ser usado na mesma transação; só ADD VALUE não pode)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BudgetSignatureStatus') THEN
    CREATE TYPE "BudgetSignatureStatus" AS ENUM
      ('NOT_ISSUED', 'AWAITING_CUSTOMER', 'AWAITING_ANKAA', 'SIGNED', 'SIGNED_OFFLINE',
       'REFUSED', 'EXPIRED', 'INVALIDATED', 'WAIVED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BudgetValueApprovalSource') THEN
    CREATE TYPE "BudgetValueApprovalSource" AS ENUM ('PORTAL', 'ON_BEHALF', 'SIGNATURE', 'LEGACY_APP', 'MIGRATED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "BudgetValueApproval" (
  "id"            text NOT NULL,
  "budgetId"      text NOT NULL,
  "source"        "BudgetValueApprovalSource" NOT NULL,     -- sem hash dos termos (DD8)
  "responsibleId" text,                                     -- tabela física do model Responsible
  "userId"        text,
  "note"          text,
  "total"         DECIMAL(12, 2),
  "decidedAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"     timestamp(3),
  "revokedReason" text,
  CONSTRAINT "BudgetValueApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BudgetValueApproval_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BudgetValueApproval_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BudgetValueApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- nota obrigatória na aprovação em nome do cliente
  CONSTRAINT "BudgetValueApproval_note_check"  CHECK ("source" <> 'ON_BEHALF' OR "note" IS NOT NULL),
  -- ator discriminado: nunca id de contato em FK de User (GOTCHA do @UserId() de 17/09)
  CONSTRAINT "BudgetValueApproval_actor_check" CHECK (NOT ("responsibleId" IS NOT NULL AND "userId" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "BudgetValueApproval_budgetId_decidedAt_idx" ON "BudgetValueApproval"("budgetId", "decidedAt");


-- DD11: o registro do "Assinado fora do sistema". Nasce vazio. O anexo é a prova: Restrict no
-- orçamento, no arquivo e no autor.
CREATE TABLE IF NOT EXISTS "BudgetOfflineSignature" (
  "id"            text NOT NULL,
  "budgetId"      text NOT NULL,
  "fileId"        text NOT NULL,
  "note"          text NOT NULL,
  "signedAt"      timestamp(3),
  "createdById"   text NOT NULL,
  "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"     timestamp(3),
  "revokedReason" text,
  CONSTRAINT "BudgetOfflineSignature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BudgetOfflineSignature_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BudgetOfflineSignature_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BudgetOfflineSignature_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BudgetOfflineSignature_note_check" CHECK (length(btrim("note")) > 0)
);
CREATE INDEX IF NOT EXISTS "BudgetOfflineSignature_budgetId_createdAt_idx" ON "BudgetOfflineSignature"("budgetId", "createdAt");

-- 2. A COLUNA DO EIXO e o seu cálculo. O cálculo só roda quando a coluna NASCE aqui: re-rodar a
--    fatia depois de um sucesso não pode sobrescrever o que a máquina nova (P14) já escreveu no eixo.
DO $eixo$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'Budget' AND column_name = 'signatureStatus') THEN

  ALTER TABLE "Budget" ADD COLUMN "signatureStatus" "BudgetSignatureStatus" NOT NULL DEFAULT 'NOT_ISSUED';

  -- 2a. O EIXO a partir do envelope VIGENTE (§2A.10): RUNNING/COMPLETED primeiro — a MESMA precedência
  --    do portão E3, que recusa emitir se existir QUALQUER coleta RUNNING ou COMPLETED —, senão o
  --    último. (Auditoria §14: com "o último" puro, o nº 584 — COMPLETED v1 + INVALIDATED v2 — ficaria
  --    "Invalidada — reemitir" com a reemissão travada pelo E3, e o nº 591 — COMPLETED v6 + REFUSED v7 —
  --    cairia em EXPIRED; os dois são dado de teste de 26/07.)
  --    RUNNING com o grupo 0 (cliente) completo = "Falta a Ankaa": predicado do advanceEnvelope
  --    (status <> SIGNED). VOIDED só existe em envelope encerrado.
  WITH vigente AS (
    SELECT DISTINCT ON ("quoteId") "id", "quoteId", "status"
    FROM "SignatureEnvelope"
    ORDER BY "quoteId", CASE WHEN "status"::text IN ('RUNNING', 'COMPLETED') THEN 0 ELSE 1 END, "createdAt" DESC, "id"
  )
  UPDATE "Budget" b SET "signatureStatus" = CASE v."status"::text
      WHEN 'RUNNING' THEN CASE WHEN NOT EXISTS (
          SELECT 1 FROM "EnvelopeSigner" s
          WHERE s."envelopeId" = v."id" AND s."orderGroup" = 0 AND s."status"::text <> 'SIGNED')
        THEN 'AWAITING_ANKAA' ELSE 'AWAITING_CUSTOMER' END
      WHEN 'COMPLETED'   THEN 'SIGNED'
      WHEN 'REFUSED'     THEN 'REFUSED'
      WHEN 'EXPIRED'     THEN 'EXPIRED'
      WHEN 'INVALIDATED' THEN 'INVALIDATED'
      ELSE 'NOT_ISSUED'                                          -- DRAFT, CANCELLED, SUPERSEDED
    END::"BudgetSignatureStatus"
  FROM vigente v
  WHERE v."quoteId" = b."id";
  --    Aprovados SEM coleta nenhuma: "Dispensada (legado)" — continuam FATURÁVEIS (DD7).
  --    Clone 23/09: 427; produção 23/09: 504.
  UPDATE "Budget" b SET "signatureStatus" = 'WAIVED'
  WHERE b."status"::text = 'APPROVED'
    AND NOT EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId" = b."id");
  --    DD7: aprovado cuja coleta vigente NÃO concluiu (vencida, recusada, invalidada, cancelada) perde a
  --    cobrança até reassinar. Produção 23/09: nº 741 (cobrança PARTIAL, já faturada) e nº 885
  --    (cobrança PENDING, trava). O dono decide caso a caso: coleta nova ou "Assinado fora do sistema" (DD11).
  INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
  SELECT 'LEGACY_APPROVED_UNSIGNED', NULL, NULL, b."id"
  FROM "Budget" b
  WHERE b."status"::text = 'APPROVED'
    AND b."signatureStatus" IN ('EXPIRED', 'REFUSED', 'INVALIDATED', 'NOT_ISSUED');

END IF;
END $eixo$;
CREATE INDEX IF NOT EXISTS "Budget_signatureStatus_idx" ON "Budget"("signatureStatus");

-- Reversão: DROP TABLE "BudgetOfflineSignature", "BudgetValueApproval"; DROP INDEX
-- "Budget_signatureStatus_idx"; DROP COLUMN "signatureStatus"; DROP TYPE dos dois enums novos.
-- Perde as aprovações do valor e as assinaturas fora do sistema gravadas depois do deploy (exportar antes).
