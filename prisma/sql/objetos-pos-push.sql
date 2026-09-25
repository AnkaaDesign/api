-- G25 — OBJETOS DE BANCO QUE `prisma db push` NÃO CRIA.
--
-- GERADO por scripts/gen-objetos-pos-push.ts a partir de um banco migrado
-- (2026-09-25). NÃO EDITAR À MÃO: regerar quando uma migration
-- criar coluna gerada, gatilho, função, índice GIN/expressão ou CHECK.
--
-- Uso, num banco de TESTE que subiu por `db push`:
--   psql "$URL" -v ON_ERROR_STOP=1 -f prisma/sql/objetos-pos-push.sql
-- Idempotente. NUNCA rodar em produção (lá tudo vem das migrations).
--
-- 2 extensões, 9 funções, 171 colunas geradas,
-- 7 gatilhos, 17 índices, 28 CHECKs.

BEGIN;

-- ── extensões ──
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ── funções ──
CREATE OR REPLACE FUNCTION public.envelope_signer_freeze_signed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD."status" = 'SIGNED' AND NEW."status" = 'SIGNED' THEN
    IF NEW."signedAt"      IS DISTINCT FROM OLD."signedAt"
    OR NEW."evidenceHash"  IS DISTINCT FROM OLD."evidenceHash"
    OR NEW."hmacSignature" IS DISTINCT FROM OLD."hmacSignature"
    OR NEW."informedCpf"   IS DISTINCT FROM OLD."informedCpf"
    OR NEW."declarations"::text IS DISTINCT FROM OLD."declarations"::text THEN
      RAISE EXCEPTION
        'Assinatura ja aplicada e imutavel (signatario %). Invalide o envelope e reemita.', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.file_block_referenced_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  refs text[];
BEGIN
  -- Valvula, mesmo padrao de ankaa.allow_signature_audit_delete: SET LOCAL, portanto vale
  -- so ate o fim da transacao e nao ha como esquece-la aberta. Existe para desmontagens
  -- deliberadas que apagam o dono ANTES do arquivo -- e para que uma limpeza consciente
  -- seja um ato explicito, nao um DELETE distraido.
  IF COALESCE(current_setting('ankaa.allow_referenced_file_delete', true), 'off') = 'on' THEN
    RETURN OLD;
  END IF;

  refs := file_blocking_references(OLD."id");

  IF COALESCE(array_length(refs, 1), 0) > 0 THEN
    RAISE EXCEPTION
      'File % ("%") esta em uso e nao pode ser excluido. Em uso por: %',
      OLD."id", OLD."filename", array_to_string(refs, ', ')
      USING
        ERRCODE = 'restrict_violation',
        HINT    = 'Desvincule o arquivo da entidade dona antes de exclui-lo. '
                  'Numa desmontagem deliberada, apague o dono primeiro ou abra a valvula '
                  'na transacao: SET LOCAL ankaa.allow_referenced_file_delete = ''on''.';
  END IF;

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.file_blocking_references(p_file_id text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  r     record;
  hit   boolean;
  refs  text[] := ARRAY[]::text[];
BEGIN
  -- Saida: coluna no proprio File. Invisivel para o catalogo de entrada -- o ponto cego
  -- que fez 32 layouts aprovados vivos parecerem orfaos.
  IF EXISTS (
    SELECT 1 FROM "File" WHERE "id" = p_file_id AND "quoteLayoutId" IS NOT NULL
  ) THEN
    -- Cast explicito: com um literal cru o parser resolve `anyarray || anyarray`
    -- e tenta ler a string como literal de array.
    refs := refs || 'File.quoteLayoutId (layout aprovado de orcamento)'::text;
  END IF;

  -- Entrada: todas as FKs que apontam para File.id.
  FOR r IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema    = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema    = 'public'
      AND ccu.table_name     = 'File'
      AND ccu.column_name    = 'id'
      -- thumbnail_jobs e dado DERIVADO do arquivo, nao um uso dele: apagar o arquivo e
      -- justamente o que deve limpar essas linhas (onDelete: Cascade).
      AND tc.table_name <> 'thumbnail_jobs'
    ORDER BY tc.table_name, kcu.column_name
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)', r.tbl, r.col)
      INTO hit USING p_file_id;
    IF hit THEN
      refs := refs || (r.tbl || '.' || r.col)::text;
    END IF;
  END LOOP;

  RETURN refs;
END;
$function$;

CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $function$;

CREATE OR REPLACE FUNCTION public.item_latest_price(p_item_id text)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  SELECT mv.value
  FROM "MonetaryValue" mv
  WHERE mv."itemId" = p_item_id
  ORDER BY mv."createdAt" DESC, mv.id DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.item_sync_total_price()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW."totalPrice" := COALESCE(item_latest_price(NEW.id), 0) * COALESCE(NEW.quantity, 0);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.monetary_value_sync_item_total_price()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_item_ids text[];
  v_item_id  text;
BEGIN
  SELECT array_agg(DISTINCT id)
  INTO v_item_ids
  FROM (
    SELECT CASE WHEN TG_OP <> 'INSERT' THEN OLD."itemId" END AS id
    UNION ALL
    SELECT CASE WHEN TG_OP <> 'DELETE' THEN NEW."itemId" END AS id
  ) candidates
  WHERE id IS NOT NULL;

  IF v_item_ids IS NULL THEN
    -- Position salary rows (itemId NULL) reuse this table; nothing to sync.
    RETURN NULL;
  END IF;

  FOREACH v_item_id IN ARRAY v_item_ids LOOP
    -- No-ops when the owning Item is being cascade-deleted in this same
    -- statement, which is the intended behaviour.
    UPDATE "Item" i
    SET "totalPrice" = COALESCE(item_latest_price(i.id), 0) * COALESCE(i.quantity, 0)
    WHERE i.id = v_item_id;
  END LOOP;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.signature_audit_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    RAISE EXCEPTION
      'SignatureAuditEvent e append-only: UPDATE nao e permitido (evento %)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (TG_OP = 'DELETE') THEN
    IF COALESCE(current_setting('ankaa.allow_signature_audit_delete', true), 'off') <> 'on' THEN
      RAISE EXCEPTION
        'SignatureAuditEvent e append-only: DELETE nao e permitido (evento %)', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

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

-- ── colunas geradas ──
-- `db push` as cria como colunas comuns; aqui viram GENERATED de novo (o valor
-- é recalculado pelo banco, e escrever nelas à mão passa a ser erro — como em produção).
ALTER TABLE "Admission" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "Admission" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "AdmissionDocument" DROP COLUMN IF EXISTS "noteNormalized";
ALTER TABLE "AdmissionDocument" ADD COLUMN "noteNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(note))) STORED;
ALTER TABLE "AgendaEvent" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "AgendaEvent" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "AgendaEvent" DROP COLUMN IF EXISTS "titleNormalized";
ALTER TABLE "AgendaEvent" ADD COLUMN "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(title))) STORED;
ALTER TABLE "Airbrushing" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Airbrushing" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Assessment" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Assessment" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Assessment" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Assessment" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "AssessmentEntry" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "AssessmentEntry" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "Backup" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Backup" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Backup" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Backup" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "BackupSchedule" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "BackupSchedule" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "BackupSchedule" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "BackupSchedule" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Benefit" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Benefit" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Benefit" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "Benefit" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "Benefit" DROP COLUMN IF EXISTS "providerNormalized";
ALTER TABLE "Benefit" ADD COLUMN "providerNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(provider))) STORED;
ALTER TABLE "BonusDiscount" DROP COLUMN IF EXISTS "referenceNormalized";
ALTER TABLE "BonusDiscount" ADD COLUMN "referenceNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(reference))) STORED;
ALTER TABLE "BonusExtra" DROP COLUMN IF EXISTS "referenceNormalized";
ALTER TABLE "BonusExtra" ADD COLUMN "referenceNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(reference))) STORED;
ALTER TABLE "Budget" DROP COLUMN IF EXISTS "queueRank";
ALTER TABLE "Budget" ADD COLUMN "queueRank" double precision GENERATED ALWAYS AS (
CASE
    WHEN (status = ANY (ARRAY['REQUESTED'::"BudgetStatus", 'EXPIRED'::"BudgetStatus", 'PENDING'::"BudgetStatus", 'APPROVED'::"BudgetStatus", 'SIGNED'::"BudgetStatus", 'CANCELLED'::"BudgetStatus"])) THEN (- EXTRACT(epoch FROM "createdAt"))
    ELSE EXTRACT(epoch FROM "createdAt")
END) STORED;
ALTER TABLE "BudgetItem" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "BudgetItem" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "ChangeLog" DROP COLUMN IF EXISTS "fieldNormalized";
ALTER TABLE "ChangeLog" ADD COLUMN "fieldNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(field))) STORED;
ALTER TABLE "ChangeLog" DROP COLUMN IF EXISTS "reasonNormalized";
ALTER TABLE "ChangeLog" ADD COLUMN "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(reason))) STORED;
ALTER TABLE "ContractPhaseHistory" DROP COLUMN IF EXISTS "reasonNormalized";
ALTER TABLE "ContractPhaseHistory" ADD COLUMN "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(reason))) STORED;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "addressNormalized";
ALTER TABLE "Customer" ADD COLUMN "addressNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(address))) STORED;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "cityNormalized";
ALTER TABLE "Customer" ADD COLUMN "cityNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(city))) STORED;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "cnpjNormalized";
ALTER TABLE "Customer" ADD COLUMN "cnpjNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(cnpj))) STORED;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "corporateNameNormalized";
ALTER TABLE "Customer" ADD COLUMN "corporateNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("corporateName"))) STORED;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "cpfNormalized";
ALTER TABLE "Customer" ADD COLUMN "cpfNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(cpf))) STORED;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "emailNormalized";
ALTER TABLE "Customer" ADD COLUMN "emailNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(email))) STORED;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "fantasyNameNormalized";
ALTER TABLE "Customer" ADD COLUMN "fantasyNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("fantasyName"))) STORED;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "neighborhoodNormalized";
ALTER TABLE "Customer" ADD COLUMN "neighborhoodNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(neighborhood))) STORED;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "stateNormalized";
ALTER TABLE "Customer" ADD COLUMN "stateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(state))) STORED;
ALTER TABLE "Dependent" DROP COLUMN IF EXISTS "cpfNormalized";
ALTER TABLE "Dependent" ADD COLUMN "cpfNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(cpf))) STORED;
ALTER TABLE "Dependent" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Dependent" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Dependent" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "Dependent" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "EconomicActivity" DROP COLUMN IF EXISTS "codeNormalized";
ALTER TABLE "EconomicActivity" ADD COLUMN "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(code))) STORED;
ALTER TABLE "EconomicActivity" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "EconomicActivity" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "EmploymentContract" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "EmploymentContract" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "EmploymentContract" DROP COLUMN IF EXISTS "providerNameNormalized";
ALTER TABLE "EmploymentContract" ADD COLUMN "providerNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("providerName"))) STORED;
ALTER TABLE "ExternalOperation" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "ExternalOperation" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "ExternalOperation" DROP COLUMN IF EXISTS "withdrawerNameNormalized";
ALTER TABLE "ExternalOperation" ADD COLUMN "withdrawerNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("withdrawerName"))) STORED;
ALTER TABLE "ExternalOperationServiceItem" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "ExternalOperationServiceItem" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "File" DROP COLUMN IF EXISTS "filenameNormalized";
ALTER TABLE "File" ADD COLUMN "filenameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(filename))) STORED;
ALTER TABLE "File" DROP COLUMN IF EXISTS "mimetypeNormalized";
ALTER TABLE "File" ADD COLUMN "mimetypeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(mimetype))) STORED;
ALTER TABLE "File" DROP COLUMN IF EXISTS "originalNameNormalized";
ALTER TABLE "File" ADD COLUMN "originalNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("originalName"))) STORED;
ALTER TABLE "FiscalDocumentItem" DROP COLUMN IF EXISTS "codeNormalized";
ALTER TABLE "FiscalDocumentItem" ADD COLUMN "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(code))) STORED;
ALTER TABLE "FiscalDocumentItem" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "FiscalDocumentItem" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "FiscalDocumentOrderCode" DROP COLUMN IF EXISTS "codeNormalized";
ALTER TABLE "FiscalDocumentOrderCode" ADD COLUMN "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(code))) STORED;
ALTER TABLE "Fispq" DROP COLUMN IF EXISTS "casNumberNormalized";
ALTER TABLE "Fispq" ADD COLUMN "casNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("casNumber"))) STORED;
ALTER TABLE "Fispq" DROP COLUMN IF EXISTS "manufacturerNormalized";
ALTER TABLE "Fispq" ADD COLUMN "manufacturerNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(manufacturer))) STORED;
ALTER TABLE "Fispq" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "Fispq" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "Fispq" DROP COLUMN IF EXISTS "onuNumberNormalized";
ALTER TABLE "Fispq" ADD COLUMN "onuNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("onuNumber"))) STORED;
ALTER TABLE "Fispq" DROP COLUMN IF EXISTS "productNameNormalized";
ALTER TABLE "Fispq" ADD COLUMN "productNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("productName"))) STORED;
ALTER TABLE "Implement" DROP COLUMN IF EXISTS "chassisNumberNormalized";
ALTER TABLE "Implement" ADD COLUMN "chassisNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("chassisNumber"))) STORED;
ALTER TABLE "Implement" DROP COLUMN IF EXISTS "plateNormalized";
ALTER TABLE "Implement" ADD COLUMN "plateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(plate))) STORED;
ALTER TABLE "Implement" DROP COLUMN IF EXISTS "serialNumberNormalized";
ALTER TABLE "Implement" ADD COLUMN "serialNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("serialNumber"))) STORED;
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "Invoice" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "Item" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Item" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Item" DROP COLUMN IF EXISTS "uniCodeNormalized";
ALTER TABLE "Item" ADD COLUMN "uniCodeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("uniCode"))) STORED;
ALTER TABLE "ItemBrand" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "ItemBrand" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "ItemCategory" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "ItemCategory" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Leave" DROP COLUMN IF EXISTS "inssBenefitNumberNormalized";
ALTER TABLE "Leave" ADD COLUMN "inssBenefitNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("inssBenefitNumber"))) STORED;
ALTER TABLE "Leave" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "Leave" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "Maintenance" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Maintenance" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Maintenance" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Maintenance" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "MaintenanceSchedule" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "MaintenanceSchedule" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "MaintenanceSchedule" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "MaintenanceSchedule" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "MedicalExam" DROP COLUMN IF EXISTS "clinicNormalized";
ALTER TABLE "MedicalExam" ADD COLUMN "clinicNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(clinic))) STORED;
ALTER TABLE "MedicalExam" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "MedicalExam" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "MedicalExam" DROP COLUMN IF EXISTS "physicianNameNormalized";
ALTER TABLE "MedicalExam" ADD COLUMN "physicianNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("physicianName"))) STORED;
ALTER TABLE "Message" DROP COLUMN IF EXISTS "titleNormalized";
ALTER TABLE "Message" ADD COLUMN "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(title))) STORED;
ALTER TABLE "MessageSchedule" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "MessageSchedule" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "MessageSchedule" DROP COLUMN IF EXISTS "titleNormalized";
ALTER TABLE "MessageSchedule" ADD COLUMN "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(title))) STORED;
ALTER TABLE "Note" DROP COLUMN IF EXISTS "contentNormalized";
ALTER TABLE "Note" ADD COLUMN "contentNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(content))) STORED;
ALTER TABLE "Note" DROP COLUMN IF EXISTS "titleNormalized";
ALTER TABLE "Note" ADD COLUMN "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(title))) STORED;
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "bodyNormalized";
ALTER TABLE "Notification" ADD COLUMN "bodyNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(body))) STORED;
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "titleNormalized";
ALTER TABLE "Notification" ADD COLUMN "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(title))) STORED;
ALTER TABLE "NotificationConfiguration" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "NotificationConfiguration" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "NotificationConfiguration" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "NotificationConfiguration" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Observation" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Observation" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Order" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Order" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Order" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "Order" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "OrderInstallment" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "OrderInstallment" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "OrderSchedule" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "OrderSchedule" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "OrderSchedule" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "OrderSchedule" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Paint" DROP COLUMN IF EXISTS "codeNormalized";
ALTER TABLE "Paint" ADD COLUMN "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(code))) STORED;
ALTER TABLE "Paint" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Paint" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "PaintBrand" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "PaintBrand" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "PaintFormula" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "PaintFormula" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "PaintType" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "PaintType" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "PayrollDiscount" DROP COLUMN IF EXISTS "lenderNameNormalized";
ALTER TABLE "PayrollDiscount" ADD COLUMN "lenderNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("lenderName"))) STORED;
ALTER TABLE "PayrollDiscount" DROP COLUMN IF EXISTS "referenceNormalized";
ALTER TABLE "PayrollDiscount" ADD COLUMN "referenceNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(reference))) STORED;
ALTER TABLE "PayrollMonthSettlement" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "PayrollMonthSettlement" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "Position" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Position" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "reasonNormalized";
ALTER TABLE "PpeDelivery" ADD COLUMN "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(reason))) STORED;
ALTER TABLE "PpeDeliverySchedule" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "PpeDeliverySchedule" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Questionnaire" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Questionnaire" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Questionnaire" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Questionnaire" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "QuestionnaireEntry" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "QuestionnaireEntry" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "QuestionnaireGroup" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "QuestionnaireGroup" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "QuestionnaireGroup" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "QuestionnaireGroup" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "QuestionnaireOption" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "QuestionnaireOption" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "QuestionnaireQuestion" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "QuestionnaireQuestion" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "QuestionnaireQuestion" DROP COLUMN IF EXISTS "titleNormalized";
ALTER TABLE "QuestionnaireQuestion" ADD COLUMN "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(title))) STORED;
ALTER TABLE "ReconciliationMatch" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "ReconciliationMatch" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "RecurrentPayable" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "RecurrentPayable" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "RecurrentPayable" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "RecurrentPayable" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Representative" DROP COLUMN IF EXISTS "cpfNormalized";
ALTER TABLE "Representative" ADD COLUMN "cpfNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(cpf))) STORED;
ALTER TABLE "Representative" DROP COLUMN IF EXISTS "emailNormalized";
ALTER TABLE "Representative" ADD COLUMN "emailNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(email))) STORED;
ALTER TABLE "Representative" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Representative" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Representative" DROP COLUMN IF EXISTS "phoneNormalized";
ALTER TABLE "Representative" ADD COLUMN "phoneNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(phone))) STORED;
ALTER TABLE "SalaryAdjustment" DROP COLUMN IF EXISTS "noteNormalized";
ALTER TABLE "SalaryAdjustment" ADD COLUMN "noteNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(note))) STORED;
ALTER TABLE "Sector" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Sector" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "ServiceOrder" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "ServiceOrder" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Skill" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Skill" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Skill" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Skill" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "StatisticsPreset" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "StatisticsPreset" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "Supplier" DROP COLUMN IF EXISTS "addressNormalized";
ALTER TABLE "Supplier" ADD COLUMN "addressNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(address))) STORED;
ALTER TABLE "Supplier" DROP COLUMN IF EXISTS "cityNormalized";
ALTER TABLE "Supplier" ADD COLUMN "cityNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(city))) STORED;
ALTER TABLE "Supplier" DROP COLUMN IF EXISTS "cnpjNormalized";
ALTER TABLE "Supplier" ADD COLUMN "cnpjNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(cnpj))) STORED;
ALTER TABLE "Supplier" DROP COLUMN IF EXISTS "corporateNameNormalized";
ALTER TABLE "Supplier" ADD COLUMN "corporateNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("corporateName"))) STORED;
ALTER TABLE "Supplier" DROP COLUMN IF EXISTS "emailNormalized";
ALTER TABLE "Supplier" ADD COLUMN "emailNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(email))) STORED;
ALTER TABLE "Supplier" DROP COLUMN IF EXISTS "fantasyNameNormalized";
ALTER TABLE "Supplier" ADD COLUMN "fantasyNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("fantasyName"))) STORED;
ALTER TABLE "Supplier" DROP COLUMN IF EXISTS "neighborhoodNormalized";
ALTER TABLE "Supplier" ADD COLUMN "neighborhoodNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(neighborhood))) STORED;
ALTER TABLE "Supplier" DROP COLUMN IF EXISTS "stateNormalized";
ALTER TABLE "Supplier" ADD COLUMN "stateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(state))) STORED;
ALTER TABLE "Task" DROP COLUMN IF EXISTS "detailsNormalized";
ALTER TABLE "Task" ADD COLUMN "detailsNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(details))) STORED;
ALTER TABLE "Task" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "Task" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "TaskFieldChangeLog" DROP COLUMN IF EXISTS "fieldNormalized";
ALTER TABLE "TaskFieldChangeLog" ADD COLUMN "fieldNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(field))) STORED;
ALTER TABLE "TaskForecastHistory" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "TaskForecastHistory" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "TaskForecastHistory" DROP COLUMN IF EXISTS "reasonNormalized";
ALTER TABLE "TaskForecastHistory" ADD COLUMN "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(reason))) STORED;
ALTER TABLE "TaxBracket" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "TaxBracket" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "TaxTable" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "TaxTable" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Termination" DROP COLUMN IF EXISTS "justCauseArticleNormalized";
ALTER TABLE "Termination" ADD COLUMN "justCauseArticleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("justCauseArticle"))) STORED;
ALTER TABLE "Termination" DROP COLUMN IF EXISTS "reasonNormalized";
ALTER TABLE "Termination" ADD COLUMN "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(reason))) STORED;
ALTER TABLE "TerminationDocument" DROP COLUMN IF EXISTS "noteNormalized";
ALTER TABLE "TerminationDocument" ADD COLUMN "noteNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(note))) STORED;
ALTER TABLE "TerminationItem" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "TerminationItem" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Thirteenth" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "Thirteenth" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "Topic" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Topic" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Topic" DROP COLUMN IF EXISTS "titleNormalized";
ALTER TABLE "Topic" ADD COLUMN "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(title))) STORED;
ALTER TABLE "TopicLevel" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "TopicLevel" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "TopicLevel" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "TopicLevel" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "TransactionCategory" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "TransactionCategory" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "User" DROP COLUMN IF EXISTS "addressNormalized";
ALTER TABLE "User" ADD COLUMN "addressNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(address))) STORED;
ALTER TABLE "User" DROP COLUMN IF EXISTS "cityNormalized";
ALTER TABLE "User" ADD COLUMN "cityNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(city))) STORED;
ALTER TABLE "User" DROP COLUMN IF EXISTS "cpfNormalized";
ALTER TABLE "User" ADD COLUMN "cpfNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(cpf))) STORED;
ALTER TABLE "User" DROP COLUMN IF EXISTS "emailNormalized";
ALTER TABLE "User" ADD COLUMN "emailNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(email))) STORED;
ALTER TABLE "User" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "User" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "User" DROP COLUMN IF EXISTS "neighborhoodNormalized";
ALTER TABLE "User" ADD COLUMN "neighborhoodNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(neighborhood))) STORED;
ALTER TABLE "User" DROP COLUMN IF EXISTS "phoneNormalized";
ALTER TABLE "User" ADD COLUMN "phoneNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(phone))) STORED;
ALTER TABLE "User" DROP COLUMN IF EXISTS "pisNormalized";
ALTER TABLE "User" ADD COLUMN "pisNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(pis))) STORED;
ALTER TABLE "User" DROP COLUMN IF EXISTS "stateNormalized";
ALTER TABLE "User" ADD COLUMN "stateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(state))) STORED;
ALTER TABLE "UserBenefit" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "UserBenefit" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "UserPositionHistory" DROP COLUMN IF EXISTS "noteNormalized";
ALTER TABLE "UserPositionHistory" ADD COLUMN "noteNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(note))) STORED;
ALTER TABLE "Vacation" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "Vacation" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "VacationGroup" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "VacationGroup" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "VacationGroup" DROP COLUMN IF EXISTS "notesNormalized";
ALTER TABLE "VacationGroup" ADD COLUMN "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(notes))) STORED;
ALTER TABLE "WarehouseLocation" DROP COLUMN IF EXISTS "codeNormalized";
ALTER TABLE "WarehouseLocation" ADD COLUMN "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(code))) STORED;
ALTER TABLE "WarehouseLocation" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "WarehouseLocation" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "WarehouseLocation" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "WarehouseLocation" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "WarehouseLocation" DROP COLUMN IF EXISTS "sectionNormalized";
ALTER TABLE "WarehouseLocation" ADD COLUMN "sectionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(section))) STORED;
ALTER TABLE "Warning" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "Warning" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "Warning" DROP COLUMN IF EXISTS "hrNotesNormalized";
ALTER TABLE "Warning" ADD COLUMN "hrNotesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("hrNotes"))) STORED;
ALTER TABLE "Warning" DROP COLUMN IF EXISTS "reasonNormalized";
ALTER TABLE "Warning" ADD COLUMN "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(reason))) STORED;
ALTER TABLE "WasteCertificate" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "WasteCertificate" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "WorkAccidentReport" DROP COLUMN IF EXISTS "catNumberNormalized";
ALTER TABLE "WorkAccidentReport" ADD COLUMN "catNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("catNumber"))) STORED;
ALTER TABLE "WorkAccidentReport" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "WorkAccidentReport" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "apps" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "apps" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "appIdNormalized";
ALTER TABLE "deployments" ADD COLUMN "appIdNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(app_id))) STORED;
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "gitCommitIdNormalized";
ALTER TABLE "deployments" ADD COLUMN "gitCommitIdNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(git_commit_id))) STORED;
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "versionNormalized";
ALTER TABLE "deployments" ADD COLUMN "versionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(version))) STORED;
ALTER TABLE "repositories" DROP COLUMN IF EXISTS "descriptionNormalized";
ALTER TABLE "repositories" ADD COLUMN "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(description))) STORED;
ALTER TABLE "repositories" DROP COLUMN IF EXISTS "nameNormalized";
ALTER TABLE "repositories" ADD COLUMN "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;

-- ── gatilhos ──
DROP TRIGGER IF EXISTS "envelope_signer_freeze_signed" ON "EnvelopeSigner";
CREATE TRIGGER envelope_signer_freeze_signed BEFORE UPDATE ON public."EnvelopeSigner" FOR EACH ROW EXECUTE FUNCTION envelope_signer_freeze_signed();
DROP TRIGGER IF EXISTS "file_no_delete_when_referenced" ON "File";
CREATE TRIGGER file_no_delete_when_referenced BEFORE DELETE ON public."File" FOR EACH ROW EXECUTE FUNCTION file_block_referenced_delete();
DROP TRIGGER IF EXISTS "Implement_keeps_task_covered" ON "Implement";
CREATE CONSTRAINT TRIGGER "Implement_keeps_task_covered" AFTER DELETE OR UPDATE OF "taskId" ON public."Implement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();
DROP TRIGGER IF EXISTS "item_total_price_sync" ON "Item";
CREATE TRIGGER item_total_price_sync BEFORE INSERT OR UPDATE OF quantity ON public."Item" FOR EACH ROW EXECUTE FUNCTION item_sync_total_price();
DROP TRIGGER IF EXISTS "monetary_value_item_total_price_sync" ON "MonetaryValue";
CREATE TRIGGER monetary_value_item_total_price_sync AFTER INSERT OR DELETE OR UPDATE ON public."MonetaryValue" FOR EACH ROW EXECUTE FUNCTION monetary_value_sync_item_total_price();
DROP TRIGGER IF EXISTS "signature_audit_no_mutate" ON "SignatureAuditEvent";
CREATE TRIGGER signature_audit_no_mutate BEFORE DELETE OR UPDATE ON public."SignatureAuditEvent" FOR EACH ROW EXECUTE FUNCTION signature_audit_append_only();
DROP TRIGGER IF EXISTS "Task_has_implement" ON "Task";
CREATE CONSTRAINT TRIGGER "Task_has_implement" AFTER INSERT ON public."Task" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();

-- ── índices (GIN/GiST, de expressão e sobre coluna gerada) ──
CREATE INDEX IF NOT EXISTS "Budget_statusOrder_queueRank_idx" ON public."Budget" USING btree ("statusOrder", "queueRank");
CREATE INDEX IF NOT EXISTS "Customer_corporateNameNormalized_trgm_idx" ON public."Customer" USING gin ("corporateNameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_fantasyNameNormalized_trgm_idx" ON public."Customer" USING gin ("fantasyNameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "File_filenameNormalized_trgm_idx" ON public."File" USING gin ("filenameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Implement_serialNumberNormalized_trgm_idx" ON public."Implement" USING gin ("serialNumberNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ItemBrand_nameNormalized_trgm_idx" ON public."ItemBrand" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ItemCategory_nameNormalized_trgm_idx" ON public."ItemCategory" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Item_nameNormalized_trgm_idx" ON public."Item" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Item_uniCodeNormalized_trgm_idx" ON public."Item" USING gin ("uniCodeNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "MessageSchedule_nameNormalized_trgm_idx" ON public."MessageSchedule" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "MessageSchedule_titleNormalized_trgm_idx" ON public."MessageSchedule" USING gin ("titleNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Paint_nameNormalized_trgm_idx" ON public."Paint" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Representative_roles_idx" ON public."Representative" USING gin (roles);
CREATE INDEX IF NOT EXISTS "Supplier_corporateNameNormalized_trgm_idx" ON public."Supplier" USING gin ("corporateNameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Supplier_fantasyNameNormalized_trgm_idx" ON public."Supplier" USING gin ("fantasyNameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Task_nameNormalized_trgm_idx" ON public."Task" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_nameNormalized_trgm_idx" ON public."User" USING gin ("nameNormalized" gin_trgm_ops);

-- ── CHECKs ──
ALTER TABLE "Airbrushing" DROP CONSTRAINT IF EXISTS "Airbrushing_dueDayOfMonth_range";
ALTER TABLE "Airbrushing" ADD CONSTRAINT "Airbrushing_dueDayOfMonth_range" CHECK ((("dueDayOfMonth" IS NULL) OR (("dueDayOfMonth" >= 1) AND ("dueDayOfMonth" <= 31))));
ALTER TABLE "Airbrushing" DROP CONSTRAINT IF EXISTS "Airbrushing_paymentTermDays_range";
ALTER TABLE "Airbrushing" ADD CONSTRAINT "Airbrushing_paymentTermDays_range" CHECK ((("paymentTermDays" IS NULL) OR (("paymentTermDays" >= 0) AND ("paymentTermDays" <= 365))));
ALTER TABLE "AirbrushingNfse" DROP CONSTRAINT IF EXISTS "AirbrushingNfse_accessKey_format";
ALTER TABLE "AirbrushingNfse" ADD CONSTRAINT "AirbrushingNfse_accessKey_format" CHECK ((("accessKey" IS NULL) OR ("accessKey" ~ '^[0-9]{50}$'::text)));
ALTER TABLE "AirbrushingNfse" DROP CONSTRAINT IF EXISTS "AirbrushingNfse_cancelReasonCode_range";
ALTER TABLE "AirbrushingNfse" ADD CONSTRAINT "AirbrushingNfse_cancelReasonCode_range" CHECK ((("cancelReasonCode" IS NULL) OR ("cancelReasonCode" = ANY (ARRAY[1, 2, 9]))));
ALTER TABLE "AirbrushingNfse" DROP CONSTRAINT IF EXISTS "AirbrushingNfse_dpsId_format";
ALTER TABLE "AirbrushingNfse" ADD CONSTRAINT "AirbrushingNfse_dpsId_format" CHECK ((("dpsId" IS NULL) OR ("dpsId" ~ '^DPS[0-9]{42}$'::text)));
ALTER TABLE "AirbrushingNfse" DROP CONSTRAINT IF EXISTS "AirbrushingNfse_environment_range";
ALTER TABLE "AirbrushingNfse" ADD CONSTRAINT "AirbrushingNfse_environment_range" CHECK ((environment = ANY (ARRAY[1, 2])));
ALTER TABLE "BudgetOfflineSignature" DROP CONSTRAINT IF EXISTS "BudgetOfflineSignature_note_check";
ALTER TABLE "BudgetOfflineSignature" ADD CONSTRAINT "BudgetOfflineSignature_note_check" CHECK ((length(btrim(note)) > 0));
ALTER TABLE "BudgetRequest" DROP CONSTRAINT IF EXISTS "BudgetRequest_decisao_unica";
ALTER TABLE "BudgetRequest" ADD CONSTRAINT "BudgetRequest_decisao_unica" CHECK ((("preApprovedAt" IS NULL) OR ("refusedAt" IS NULL)));
ALTER TABLE "BudgetValueApproval" DROP CONSTRAINT IF EXISTS "BudgetValueApproval_actor_check";
ALTER TABLE "BudgetValueApproval" ADD CONSTRAINT "BudgetValueApproval_actor_check" CHECK ((NOT (("responsibleId" IS NOT NULL) AND ("userId" IS NOT NULL))));
ALTER TABLE "BudgetValueApproval" DROP CONSTRAINT IF EXISTS "BudgetValueApproval_note_check";
ALTER TABLE "BudgetValueApproval" ADD CONSTRAINT "BudgetValueApproval_note_check" CHECK (((source <> 'ON_BEHALF'::"BudgetValueApprovalSource") OR (note IS NOT NULL)));
ALTER TABLE "EnvelopeSigner" DROP CONSTRAINT IF EXISTS "EnvelopeSigner_contact_matches_auth_method";
ALTER TABLE "EnvelopeSigner" ADD CONSTRAINT "EnvelopeSigner_contact_matches_auth_method" CHECK (
CASE "authMethod"
    WHEN 'EMAIL_OTP'::"SignatureAuthMethod" THEN (("declaredEmail" IS NOT NULL) AND (btrim("declaredEmail") <> ''::text))
    WHEN 'WHATSAPP_OTP'::"SignatureAuthMethod" THEN (("declaredPhone" IS NOT NULL) AND (btrim("declaredPhone") <> ''::text))
    WHEN 'SMS_OTP'::"SignatureAuthMethod" THEN (("declaredPhone" IS NOT NULL) AND (btrim("declaredPhone") <> ''::text))
    ELSE true
END) NOT VALID;
ALTER TABLE "EnvelopeSigner" DROP CONSTRAINT IF EXISTS "EnvelopeSigner_exactly_one_identity";
ALTER TABLE "EnvelopeSigner" ADD CONSTRAINT "EnvelopeSigner_exactly_one_identity" CHECK ((("responsibleId" IS NULL) <> ("userId" IS NULL)));
ALTER TABLE "FiscalDpsSequence" DROP CONSTRAINT IF EXISTS "FiscalDpsSequence_environment_range";
ALTER TABLE "FiscalDpsSequence" ADD CONSTRAINT "FiscalDpsSequence_environment_range" CHECK ((environment = ANY (ARRAY[1, 2])));
ALTER TABLE "FiscalDpsSequence" DROP CONSTRAINT IF EXISTS "FiscalDpsSequence_lastNumber_range";
ALTER TABLE "FiscalDpsSequence" ADD CONSTRAINT "FiscalDpsSequence_lastNumber_range" CHECK ((("lastNumber" >= 0) AND ("lastNumber" <= '999999999999999'::bigint)));
ALTER TABLE "FiscalEmitterProfile" DROP CONSTRAINT IF EXISTS "FiscalEmitterProfile_cTribNac_format";
ALTER TABLE "FiscalEmitterProfile" ADD CONSTRAINT "FiscalEmitterProfile_cTribNac_format" CHECK (("cTribNac" ~ '^[0-9]{6}$'::text));
ALTER TABLE "FiscalEmitterProfile" DROP CONSTRAINT IF EXISTS "FiscalEmitterProfile_cnpj_format";
ALTER TABLE "FiscalEmitterProfile" ADD CONSTRAINT "FiscalEmitterProfile_cnpj_format" CHECK ((cnpj ~ '^[0-9]{14}$'::text));
ALTER TABLE "FiscalEmitterProfile" DROP CONSTRAINT IF EXISTS "FiscalEmitterProfile_environment_range";
ALTER TABLE "FiscalEmitterProfile" ADD CONSTRAINT "FiscalEmitterProfile_environment_range" CHECK ((environment = ANY (ARRAY[1, 2])));
ALTER TABLE "FiscalEmitterProfile" DROP CONSTRAINT IF EXISTS "FiscalEmitterProfile_municipalityIbgeCode_format";
ALTER TABLE "FiscalEmitterProfile" ADD CONSTRAINT "FiscalEmitterProfile_municipalityIbgeCode_format" CHECK (("municipalityIbgeCode" ~ '^[0-9]{7}$'::text));
ALTER TABLE "FiscalEmitterProfile" DROP CONSTRAINT IF EXISTS "FiscalEmitterProfile_opSimpNac_range";
ALTER TABLE "FiscalEmitterProfile" ADD CONSTRAINT "FiscalEmitterProfile_opSimpNac_range" CHECK (("opSimpNac" = ANY (ARRAY[1, 2, 3])));
ALTER TABLE "FiscalEmitterProfile" DROP CONSTRAINT IF EXISTS "FiscalEmitterProfile_serie_format";
ALTER TABLE "FiscalEmitterProfile" ADD CONSTRAINT "FiscalEmitterProfile_serie_format" CHECK (((serie ~ '^[0-9]{1,5}$'::text) AND (((serie)::integer < 80000) OR ((serie)::integer > 89999))));
ALTER TABLE "Implement" DROP CONSTRAINT IF EXISTS "Implement_rearDoorBarCount_check";
ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorBarCount_check" CHECK ((("rearDoorBarCount" IS NULL) OR ("rearDoorBarCount" = ANY (ARRAY[2, 3, 4]))));
ALTER TABLE "Implement" DROP CONSTRAINT IF EXISTS "Implement_rearDoorHatchCount_check";
ALTER TABLE "Implement" ADD CONSTRAINT "Implement_rearDoorHatchCount_check" CHECK ((("rearDoorHatchCount" IS NULL) OR (("rearDoorHatchCount" >= 0) AND ("rearDoorHatchCount" <= 6))));
ALTER TABLE "Layout" DROP CONSTRAINT IF EXISTS "Layout_decision_note_check";
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_decision_note_check" CHECK (((status <> 'REPROVED'::"LayoutStatus") OR ("approvalSource" IS DISTINCT FROM 'PORTAL'::"LayoutApprovalSource") OR ("decisionNote" IS NOT NULL)));
ALTER TABLE "Layout" DROP CONSTRAINT IF EXISTS "Layout_one_owner_check";
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_one_owner_check" CHECK ((("implementId" IS NOT NULL) <> ("airbrushingId" IS NOT NULL)));
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_exactly_one_recipient";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_exactly_one_recipient" CHECK ((("userId" IS NULL) <> ("responsibleId" IS NULL)));
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_has_anchor";
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_has_anchor" CHECK (((((((((("fiscalDocumentId" IS NOT NULL))::integer + (("bankSlipId" IS NOT NULL))::integer) + (("installmentId" IS NOT NULL))::integer) + (("orderInstallmentId" IS NOT NULL))::integer) + (("recurrentOccurrenceId" IS NOT NULL))::integer) + (("airbrushingId" IS NOT NULL))::integer) + (("payrollMonthSettlementId" IS NOT NULL))::integer) >= 1));
ALTER TABLE "SignatureAuditEvent" DROP CONSTRAINT IF EXISTS "SignatureAuditEvent_sequence_non_negative";
ALTER TABLE "SignatureAuditEvent" ADD CONSTRAINT "SignatureAuditEvent_sequence_non_negative" CHECK ((sequence >= 0));
ALTER TABLE "SigningChallenge" DROP CONSTRAINT IF EXISTS "SigningChallenge_attempts_within_bounds";
ALTER TABLE "SigningChallenge" ADD CONSTRAINT "SigningChallenge_attempts_within_bounds" CHECK (((attempts >= 0) AND (attempts <= "maxAttempts")));

COMMIT;
