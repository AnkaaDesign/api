-- M1s — a série vai para o implemento e toda tarefa passa a ter implemento (release R-B, logo
-- depois da M1; DD1; PLANO §3.1, §3.3, §4.2; fonte 10-serie-api.md §4.4).
--
-- FATIA ESCRITA E ENSAIADA NO P10, PROMOVIDA PELO P11a junto com a M1 (protocolo do §4.1), no
-- MESMO commit em que os seis escritores da série (W1..W6) passam a gravar no implemento: o
-- gatilho "Task_serial_is_mirror" recusa quem ainda gravar em Task.serialNumber, e o
-- CONSTRAINT TRIGGER "Task_has_implement" recusa, no COMMIT, tarefa criada sem implemento.
-- Blocos do esquema-alvo que esta fatia traz:
--   · Implement.serialNumber String? @unique; Implement.serialNumberNormalized (gerada, omit global);
--   · Implement.spot SEM @default(YARD_WAIT);
--   · Task.serialNumber SEM @unique (espelho; a coluna gerada e o GIN da tarefa ficam até a M5s).
-- Objetos de banco (G25; bloco "M1s" de prisma/staged/r-b/objetos-pos-push.r-b.sql): 3 funções,
-- 4 gatilhos (2 comuns + 2 CONSTRAINT TRIGGER diferidos), 1 coluna gerada, 1 índice GIN.
--
-- Pré-condição: "Implement" existe (M1). Uma transação (o Prisma roda o arquivo inteiro numa só).
-- Idempotente (§4.5): IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS em tudo; o INSERT de
-- implementos é WHERE NOT EXISTS.

-- 0. ARQUIVO MORTO (reversão e auditoria; fica até uma limpeza explícita)
CREATE TABLE IF NOT EXISTS "_Mig0924_SerialImplementCreated" (
  "implementId" text PRIMARY KEY,
  "taskId"      text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS "_Mig0924_TaskSerial" AS
  SELECT "id" AS "taskId", "serialNumber" FROM "Task" WHERE "serialNumber" IS NOT NULL;

-- 1. UM IMPLEMENTO PARA TODA TAREFA (clone 23/09: 1.678; produção 23/09: 1.676 — todas COMPLETED).
--    spot NULL EXPLÍCITO (o default YARD_WAIT poria O.S. concluídas "no pátio");
--    createdAt/updatedAt DA TAREFA (listas e sincronizações por updatedAt não podem ver 1.678 "novos").
WITH c AS (
  INSERT INTO "Implement" ("id", "taskId", "spot", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, t."id", NULL, t."createdAt", t."updatedAt"
  FROM "Task" t
  WHERE NOT EXISTS (SELECT 1 FROM "Implement" i WHERE i."taskId" = t."id")
  RETURNING "id", "taskId"
)
INSERT INTO "_Mig0924_SerialImplementCreated" ("implementId", "taskId")
SELECT "id", "taskId" FROM c;

-- 2. A SÉRIE NO IMPLEMENTO — cópia BYTE A BYTE (sem trim/upper: S-7; as 42 séries fora da regex
--    ^[A-Z0-9-]+$ migram como estão, V15; o hash do snapshot compara o valor lido).
ALTER TABLE "Implement" ADD COLUMN IF NOT EXISTS "serialNumber" TEXT;
UPDATE "Implement" i SET "serialNumber" = t."serialNumber"
  FROM "Task" t
 WHERE t."id" = i."taskId" AND i."serialNumber" IS DISTINCT FROM t."serialNumber";
CREATE UNIQUE INDEX IF NOT EXISTS "Implement_serialNumber_key" ON "Implement"("serialNumber");  -- clone: 0 duplicatas
ALTER TABLE "Implement" ADD COLUMN IF NOT EXISTS "serialNumberNormalized" text
  GENERATED ALWAYS AS (lower(immutable_unaccent("serialNumber"))) STORED;
CREATE INDEX IF NOT EXISTS "Implement_serialNumberNormalized_trgm_idx"
  ON "Implement" USING gin ("serialNumberNormalized" gin_trgm_ops);

-- 3. UMA UNICIDADE SÓ (S-3). A coluna gerada e o GIN da Task FICAM até a M5s (espelho).
DROP INDEX IF EXISTS "Task_serialNumber_key";

-- 4. ESPELHO Implement → Task (sem tocar Task.updatedAt: o Prisma é quem escreve updatedAt)
CREATE OR REPLACE FUNCTION implement_serial_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Task" SET "serialNumber" = NEW."serialNumber"
   WHERE "id" = NEW."taskId" AND "serialNumber" IS DISTINCT FROM NEW."serialNumber";
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "Implement_serial_mirror" ON "Implement";
CREATE TRIGGER "Implement_serial_mirror" AFTER INSERT OR UPDATE OF "serialNumber", "taskId"
  ON "Implement" FOR EACH ROW EXECUTE FUNCTION implement_serial_mirror();

-- 5. Task.serialNumber SÓ muda pelo espelho (profundidade 2). Escrita direta = erro barulhento.
--    Consequência: a criação da tarefa grava a série no IMPLEMENTO aninhado (W1); o INSERT da Task
--    vem com serialNumber NULL e o espelho a preenche. `tx.task.create({ data: { serialNumber } })`
--    passa a falhar — é o que o G19 caça.
CREATE OR REPLACE FUNCTION task_serial_is_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND NEW."serialNumber" IS DISTINCT FROM
     (CASE WHEN TG_OP = 'UPDATE' THEN OLD."serialNumber" ELSE NULL END) THEN
    RAISE EXCEPTION 'Task.serialNumber é espelho de Implement.serialNumber: grave no implemento'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "Task_serial_is_mirror" ON "Task";
CREATE TRIGGER "Task_serial_is_mirror" BEFORE INSERT OR UPDATE OF "serialNumber"
  ON "Task" FOR EACH ROW EXECUTE FUNCTION task_serial_is_mirror();

-- 6. TODA TAREFA TEM IMPLEMENTO — verificado no COMMIT (o create aninhado do Prisma roda na
--    mesma transação, então o diferido funciona). FICAM PARA SEMPRE (a M5s não os derruba).
--    DELETE da Task leva o implemento em cascata (onDelete: Cascade) e o gatilho aceita: a
--    tarefa não existe mais.
--    ⚠️ IF, não CASE: numa expressão CASE o plpgsql resolve OLD."taskId" também no ramo que não
--    roda, e no gatilho da Task (que não tem essa coluna) a inserção de TODA tarefa falhava com
--    42703 "record old has no field taskId" (o rascunho do §4.2 tinha o CASE; o ensaio pegou).
CREATE OR REPLACE FUNCTION task_must_have_implement() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
DROP TRIGGER IF EXISTS "Task_has_implement" ON "Task";
CREATE CONSTRAINT TRIGGER "Task_has_implement" AFTER INSERT ON "Task"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();
DROP TRIGGER IF EXISTS "Implement_keeps_task_covered" ON "Implement";
CREATE CONSTRAINT TRIGGER "Implement_keeps_task_covered" AFTER DELETE OR UPDATE OF "taskId" ON "Implement"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_must_have_implement();

-- 7. S-8: sem o default que põe veículo não chegado "no pátio"
ALTER TABLE "Implement" ALTER COLUMN "spot" DROP DEFAULT;

-- Reversão (dentro da janela; nada se perde, a Task teve a série o tempo todo pelo espelho):
--   DROP dos 4 gatilhos e das 3 funções; CREATE UNIQUE INDEX "Task_serialNumber_key" ON "Task"("serialNumber");
--   DROP INDEX "Implement_serialNumberNormalized_trgm_idx"; DROP COLUMN "serialNumberNormalized",
--   "serialNumber" do implemento; ALTER COLUMN "spot" SET DEFAULT 'YARD_WAIT';
--   DELETE dos implementos de "_Mig0924_SerialImplementCreated" SÓ se ainda sem placa, chassi, medida,
--   arte e projeto (senão ficam: o código velho aceita tarefa com caminhão).
