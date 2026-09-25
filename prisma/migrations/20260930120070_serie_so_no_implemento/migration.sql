-- ═══════════════════════════════════════════════════════════════════════════
-- A SÉRIE SÓ NO IMPLEMENTO (decisão do dono, 25/09/2026 — "tirar tudo agora")
--
-- A M1s levou a série para `Implement.serialNumber` e deixou `Task.serialNumber`
-- como ESPELHO somente leitura (um gatilho copiava do implemento, outro recusava
-- escrita direta), para os clientes instalados continuarem lendo pela tarefa.
-- Com a DD13 (migração completa, todos os clientes sobem juntos) o espelho é
-- compatibilidade e sai: a série existe num lugar só. Era a M5s do plano, que ia
-- para a R-D; agora entra na mesma release. Contrato: NOMENCLATURA.md §5.
--
-- Pré-condição: a M1s copiou a série de toda tarefa para o implemento dela (o
-- ensaio conferiu 0 divergências); o passo 1 prova de novo antes de apagar.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Nenhuma série da tarefa pode se perder: se a coluna ainda existe, todo valor
--    dela tem de estar no implemento da mesma tarefa.
DO $$
DECLARE divergentes integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Task' AND column_name = 'serialNumber'
  ) THEN
    EXECUTE $q$
      SELECT count(*) FROM "Task" t
      LEFT JOIN "Implement" i ON i."taskId" = t."id"
      WHERE t."serialNumber" IS NOT NULL
        AND i."serialNumber" IS DISTINCT FROM t."serialNumber"
    $q$ INTO divergentes;
    IF divergentes > 0 THEN
      RAISE EXCEPTION 'Série: % tarefa(s) com série fora do implemento; nada foi apagado', divergentes;
    END IF;
  END IF;
END $$;

-- 2. O espelho e a guarda dele.
DROP TRIGGER IF EXISTS "Implement_serial_mirror" ON "Implement";
DROP TRIGGER IF EXISTS "Task_serial_is_mirror" ON "Task";
DROP FUNCTION IF EXISTS implement_serial_mirror();
DROP FUNCTION IF EXISTS task_serial_is_mirror();

-- 3. A coluna da tarefa, a gerada e o índice de busca dela (a busca passa a ser
--    no implemento: `Implement_serialNumberNormalized_trgm_idx`, da M1s).
DROP INDEX IF EXISTS "Task_serialNumberNormalized_trgm_idx";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "serialNumberNormalized";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "serialNumber";
