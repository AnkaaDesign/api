-- M0 — release R-A (antecipada; aditiva). Plano do implemento, §4.1/§4.2.
--
-- Só acrescenta tipo e valor de enum: o código velho ignora os dois, então vai
-- a produção dias antes da R-B. Vai antes de propósito: valor novo de enum não
-- pode ser USADO na mesma transação em que nasce ("unsafe use of new value"),
-- e o ensaio de M1–M3 roda numa transação revertida que já grava
-- PENDING_APPROVAL/SUPERSEDED e a origem da aprovação.
--
-- Nenhum modelo usa os tipos novos ainda; quem passa a usá-los são as fatias da
-- R-B (M2: RearDoorLeaves; M3: LayoutStatus novo e LayoutApprovalSource).
--
-- Idempotente: ADD VALUE IF NOT EXISTS e CREATE TYPE guardado por pg_type.
-- LayoutApprovalSource nasce com os CINCO valores (auditoria §14 do plano: sem
-- MIGRATED_ENVELOPE o passo 5 da M3 falha inteiro com "invalid input value").

ALTER TYPE "LayoutStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "LayoutStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LayoutApprovalSource') THEN
    CREATE TYPE "LayoutApprovalSource" AS ENUM ('PORTAL','ON_BEHALF','MIGRATED_TASK','MIGRATED_BUDGET','MIGRATED_ENVELOPE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RearDoorLeaves') THEN
    CREATE TYPE "RearDoorLeaves" AS ENUM ('BIPARTITE','TRIPARTITE');
  END IF;
END $$;
