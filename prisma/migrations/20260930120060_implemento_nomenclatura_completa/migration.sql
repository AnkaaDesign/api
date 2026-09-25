-- ═══════════════════════════════════════════════════════════════════════════
-- NOMENCLATURA COMPLETA DO IMPLEMENTO (DD13, 24/09/2026) — P11a
--
-- "Não quero nenhum valor antigo, nem mesmo para compatibilidade." O nome antigo
-- do implemento (`truck`) sai também dos DADOS que o sistema grava e lê. Esta
-- migração vem depois da M1/M1s (Truck → Implement) e antes da M2.
-- Contrato: docs/implemento/NOMENCLATURA.md §2.
--
-- NÃO toca (NOMENCLATURA.md §2 e §4):
--   · texto de negócio digitado por gente (nome de cliente, arquivo, NF, O.S.);
--   · o TEXTO dos avisos já enviados (Notification.title/body/channelTemplates);
--   · o JSON selado dos documentos assinados (SignatureEnvelope.quoteSnapshot);
--   · os valores de categoria TRUCK/BITRUCK e a montadora TRUCK_MANUFACTURER;
--   · o nome de ÍCONE "truck" gravado nas preferências de painel (é um glifo).
--
-- Idempotente: cada passo só age se ainda houver o nome antigo.
-- ═══════════════════════════════════════════════════════════════════════════

-- Chave de aviso / campo de evento: o mesmo mapa em todo lugar.
CREATE OR REPLACE FUNCTION pg_temp.implemento_campo(campo text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN campo = 'truck.implementType' THEN 'implement.type'
    WHEN campo = 'truck.implementMeasure' THEN 'implement.measures'
    WHEN campo LIKE 'truck.%' THEN 'implement.' || substring(campo FROM 7)
    ELSE campo
  END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.implemento_chave(chave text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN chave LIKE 'task.field.truck.%' THEN 'task.field.' || pg_temp.implemento_campo(substring(chave FROM 12))
    WHEN chave = 'truck.movement_request' THEN 'implement.movement_request'
    ELSE chave
  END
$f$;

-- 1. TIPOS ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TRUCK_SPOT') THEN
    ALTER TYPE "TRUCK_SPOT" RENAME TO "IMPLEMENT_SPOT";
  END IF;
  -- RENAME VALUE: toda linha de ChangeLog com TRUCK passa a ler IMPLEMENT, sem UPDATE.
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ChangeLogEntityType' AND e.enumlabel = 'TRUCK'
  ) THEN
    ALTER TYPE "ChangeLogEntityType" RENAME VALUE 'TRUCK' TO 'IMPLEMENT';
  END IF;
END $$;

-- 2. HISTÓRICO ────────────────────────────────────────────────────────────────
-- Histórico da TAREFA: `truck.<campo>` → `implement.<campo>` (e `implement.type`).
-- (`fieldNormalized` é coluna gerada e acompanha sozinha.)
UPDATE "TaskFieldChangeLog" SET "field" = pg_temp.implemento_campo("field")
WHERE "field" LIKE 'truck.%';

UPDATE "ChangeLog" SET "field" = pg_temp.implemento_campo("field")
WHERE "field" LIKE 'truck.%';

-- Trilha da entidade IMPLEMENT: a coluna `implementType` virou `type` na M1.
UPDATE "ChangeLog" SET "field" = 'type'
WHERE "entityType" = 'IMPLEMENT' AND "field" = 'implementType';

-- A tarefa registrava categoria e tipo do implemento com o nome solto (a tarefa
-- não tem essas colunas): passam ao nome do implemento, como as linhas novas.
UPDATE "ChangeLog" SET "field" = 'implement.category'
WHERE "entityType" = 'TASK' AND "field" = 'category';
UPDATE "ChangeLog" SET "field" = 'implement.type'
WHERE "entityType" = 'TASK' AND "field" = 'implementType';

-- `copiedFields` do "copiar de outra tarefa": o token `truck`.
UPDATE "ChangeLog" SET "metadata" = replace("metadata"::text, '"truck"', '"implement"')::jsonb
WHERE "metadata"::text LIKE '%"truck"%';
UPDATE "TaskFieldChangeLog" SET "metadata" = replace("metadata"::text, '"truck"', '"implement"')::jsonb
WHERE "metadata"::text LIKE '%"truck"%';

-- 3. AVISOS ───────────────────────────────────────────────────────────────────
-- Renomear NO LUGAR preserva o id da configuração e tudo o que aponta para ele
-- (canais, regras de alvo, preferências de silenciar).
UPDATE "NotificationConfiguration"
SET "key" = pg_temp.implemento_chave("key"),
    "eventType" = pg_temp.implemento_chave("eventType")
WHERE "key" LIKE 'task.field.truck.%' OR "key" = 'truck.movement_request'
   OR "eventType" LIKE 'task.field.truck.%' OR "eventType" = 'truck.movement_request';

UPDATE "NotificationConfiguration"
SET "metadata" = jsonb_set("metadata", '{field}', to_jsonb(pg_temp.implemento_campo("metadata"->>'field')))
WHERE "metadata"->>'field' LIKE 'truck.%';

UPDATE "UserNotificationPreference" SET "eventType" = pg_temp.implemento_chave("eventType")
WHERE "eventType" LIKE 'task.field.truck.%' OR "eventType" = 'truck.movement_request';

-- Chaves ANTIGAS que não estão mais no registro (legado dormente que a produção
-- guarda: "prod rows are never deleted"): o texto também deixa de dizer caminhão.
UPDATE "NotificationConfiguration" SET
  "name" = replace(replace("name", 'Caminhão', 'Implemento'), 'Caminhao', 'Implemento'),
  "description" = replace(replace(replace(replace("description",
      'Caminhão', 'Implemento'), 'Caminhao', 'Implemento'), 'caminhão', 'implemento'), 'caminhao', 'implemento'),
  "templates" = replace(replace(replace(replace("templates"::text,
      'Caminhão', 'Implemento'), 'Caminhao', 'Implemento'), 'caminhão', 'implemento'), 'caminhao', 'implemento')::jsonb,
  "metadata" = replace(replace(replace(replace("metadata"::text,
      'task.field.truck.implementType', 'task.field.implement.type'),
      'task.field.truck.implementMeasure', 'task.field.implement.measures'),
      'task.field.truck.', 'task.field.implement.'),
      'truck.movement_request', 'implement.movement_request')::jsonb
WHERE "key" LIKE 'task.field.implement.%' OR "key" = 'implement.movement_request';

-- Nome, descrição, modelos e metadados de TODA configuração cujo texto mudou no
-- registro (prisma/scripts/seed-notification-configs.ts) com esta troca — iguais
-- ao registro, byte a byte. Chave ausente no banco = no-op.
UPDATE "NotificationConfiguration" SET "name" = E'Tarefa Concluida', "description" = E'Tarefa concluída — implemento finalizado (transição de status para Concluída).', "templates" = E'{"inApp":{"title":"Tarefa Concluída","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi concluída — implemento finalizado."},"push":{"title":"Tarefa Concluída","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — concluída, implemento finalizado"},"email":{"subject":"Tarefa Concluída - {{taskName}}","body":"A tarefa foi concluída — implemento finalizado.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi concluída — implemento finalizado."}}'::jsonb, "metadata" = E'{"registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.completed\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.completed';
UPDATE "NotificationConfiguration" SET "name" = E'Data de Entrada Alterada', "description" = E'Data de entrada do implemento alterada ou removida (rastreador de campos da tarefa).', "templates" = E'{"inApp":{"title":"Data de Entrada Alterada","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a data de entrada alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}."},"push":{"title":"Data de Entrada Alterada","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — entrada: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}"},"email":{"subject":"Data de Entrada Alterada - {{taskName}}","body":"A tarefa teve a data de entrada alterada.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a data de entrada alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}."}}'::jsonb, "metadata" = E'{"field":"entryDate","category":"DATES","formatter":"formatDate","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.entryDate\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.entryDate';
UPDATE "NotificationConfiguration" SET "name" = E'Previsao de Liberacao Atualizada', "description" = E'Previsão de liberação do implemento alterada ou removida (rastreador de campos da tarefa).', "templates" = E'{"inApp":{"title":"Previsão de Liberação Alterada","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a previsão de liberação alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}."},"push":{"title":"Previsão de Liberação Alterada","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — previsão: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}"},"email":{"subject":"Previsão de Liberação Alterada - {{taskName}}","body":"A tarefa teve a previsão de liberação alterada.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a previsão de liberação alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}."}}'::jsonb, "metadata" = E'{"field":"forecastDate","category":"DATES","formatter":"formatDate","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.forecastDate\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.forecastDate';
UPDATE "NotificationConfiguration" SET "name" = E'Layout Traseira Alterado', "description" = E'(Legado — consolidado na notificação única de Medidas do Implemento; nunca dispara.)', "templates" = E'{"inApp":{"title":"Layout Traseira Alterado","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout da traseira do implemento alterado."},"push":{"title":"Layout Traseira Alterado","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — layout do implemento alterado"},"email":{"subject":"Layout Traseira Alterado - {{taskName}}","body":"A tarefa teve o layout da traseira alterado.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout da traseira do implemento alterado."}}'::jsonb, "metadata" = E'{"field":"implement.backSideMeasureId","category":"PRODUCTION","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.implement.backSideMeasureId\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.implement.backSideMeasureId';
UPDATE "NotificationConfiguration" SET "name" = E'Categoria do Implemento Alterada', "description" = E'Categoria do implemento da tarefa alterada (rastreador de campos da tarefa).', "templates" = E'{"inApp":{"title":"Categoria do Implemento Alterada","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a categoria do implemento alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."},"push":{"title":"Categoria do Implemento Alterada","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — categoria: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}"},"email":{"subject":"Categoria do Implemento Alterada - {{taskName}}","body":"A tarefa teve a categoria do implemento alterada.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a categoria do implemento alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."}}'::jsonb, "metadata" = E'{"field":"implement.category","category":"PRODUCTION","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.implement.category\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.implement.category';
UPDATE "NotificationConfiguration" SET "name" = E'Chassi do Implemento Alterado', "description" = E'Número do chassi do implemento da tarefa alterado (rastreador de campos da tarefa).', "templates" = E'{"inApp":{"title":"Chassi do Implemento Alterado","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o chassi do implemento alterado{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."},"push":{"title":"Chassi do Implemento Alterado","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — chassi: {{#if newValue}}{{newValue}}{{else}}removido{{/if}}"},"email":{"subject":"Chassi do Implemento Alterado - {{taskName}}","body":"A tarefa teve o chassi do implemento alterado.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o chassi do implemento alterado{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."}}'::jsonb, "metadata" = E'{"field":"implement.chassisNumber","category":"PRODUCTION","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.implement.chassisNumber\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.implement.chassisNumber';
UPDATE "NotificationConfiguration" SET "name" = E'Tipo de Implemento Alterado', "description" = E'Tipo do implemento da tarefa alterado (rastreador de campos da tarefa).', "templates" = E'{"inApp":{"title":"Tipo de Implemento Alterado","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o tipo de implemento alterado{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."},"push":{"title":"Tipo de Implemento Alterado","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — implemento: {{#if newValue}}{{newValue}}{{else}}removido{{/if}}"},"email":{"subject":"Tipo de Implemento Alterado - {{taskName}}","body":"A tarefa teve o tipo de implemento alterado.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o tipo de implemento alterado{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."}}'::jsonb, "metadata" = E'{"field":"implement.type","category":"PRODUCTION","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.implement.type\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.implement.type';
UPDATE "NotificationConfiguration" SET "name" = E'Medidas do Implemento Atualizadas', "description" = E'Medidas do implemento da tarefa atualizadas (notificação única consolidada, não uma por lado).', "templates" = E'{"inApp":{"title":"Medidas do Implemento Atualizadas","body":"As medidas do implemento da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foram atualizadas{{#if layoutChangeSummary}} ({{layoutChangeSummary}}){{/if}}."},"push":{"title":"Medidas Atualizadas","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — medidas do implemento atualizadas"},"whatsapp":{"body":"As medidas do implemento da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foram atualizadas{{#if layoutChangeSummary}} ({{layoutChangeSummary}}){{/if}}."}}'::jsonb, "metadata" = E'{"trigger":"layout.service.ts (batch) + task-field-tracker.service.ts (colapsar trio)","registry":"seed-notification-configs","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.implement.measures';
UPDATE "NotificationConfiguration" SET "name" = E'Layout Lado Esquerdo Alterado', "description" = E'(Legado — consolidado na notificação única de Medidas do Implemento; nunca dispara.)', "templates" = E'{"inApp":{"title":"Layout Lado Esquerdo Alterado","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout do lado esquerdo do implemento alterado."},"push":{"title":"Layout Lado Esquerdo Alterado","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — layout do implemento alterado"},"email":{"subject":"Layout Lado Esquerdo Alterado - {{taskName}}","body":"A tarefa teve o layout do lado esquerdo alterado.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout do lado esquerdo do implemento alterado."}}'::jsonb, "metadata" = E'{"field":"implement.leftSideMeasureId","category":"PRODUCTION","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.implement.leftSideMeasureId\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.implement.leftSideMeasureId';
UPDATE "NotificationConfiguration" SET "name" = E'Placa do Implemento Alterada', "description" = E'Placa do implemento da tarefa alterada (rastreador de campos da tarefa).', "templates" = E'{"inApp":{"title":"Placa do Implemento Alterada","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a placa do implemento alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."},"push":{"title":"Placa do Implemento Alterada","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — placa: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}"},"email":{"subject":"Placa do Implemento Alterada - {{taskName}}","body":"A tarefa teve a placa do implemento alterada.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a placa do implemento alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."}}'::jsonb, "metadata" = E'{"field":"implement.plate","category":"PRODUCTION","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.implement.plate\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.implement.plate';
UPDATE "NotificationConfiguration" SET "name" = E'Layout Lado Direito Alterado', "description" = E'(Legado — consolidado na notificação única de Medidas do Implemento; nunca dispara.)', "templates" = E'{"inApp":{"title":"Layout Lado Direito Alterado","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout do lado direito do implemento alterado."},"push":{"title":"Layout Lado Direito Alterado","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — layout do implemento alterado"},"email":{"subject":"Layout Lado Direito Alterado - {{taskName}}","body":"A tarefa teve o layout do lado direito alterado.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout do lado direito do implemento alterado."}}'::jsonb, "metadata" = E'{"field":"implement.rightSideMeasureId","category":"PRODUCTION","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.implement.rightSideMeasureId\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.implement.rightSideMeasureId';
UPDATE "NotificationConfiguration" SET "name" = E'Vaga do Implemento Alterada', "description" = E'Vaga do implemento na garagem alterada (rastreador de campos da tarefa).', "templates" = E'{"inApp":{"title":"Vaga do Implemento Alterada","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a vaga na garagem alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."},"push":{"title":"Vaga do Implemento Alterada","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — vaga: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}"},"email":{"subject":"Vaga do Implemento Alterada - {{taskName}}","body":"A tarefa teve a vaga na garagem alterada.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a vaga na garagem alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."}}'::jsonb, "metadata" = E'{"field":"implement.spot","category":"PRODUCTION","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.field.implement.spot\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.field.implement.spot';
UPDATE "NotificationConfiguration" SET "name" = E'Previsao de Liberacao em 10 Dias', "description" = E'Faltam 10 dias para a previsão de liberação do implemento (fase de preparação, tarefa ainda não liberada).', "templates" = E'{"inApp":{"title":"Previsão de Liberação em 10 Dias","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 10 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."},"push":{"title":"Previsão de Liberação em 10 Dias","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista em 10 dias"},"email":{"subject":"Previsão de Liberação em 10 Dias - {{taskName}}","body":"A tarefa tem previsão de liberação em 10 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 10 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."}}'::jsonb, "metadata" = E'{"registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.forecast_10days\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.forecast_10days';
UPDATE "NotificationConfiguration" SET "name" = E'Previsao de Liberacao Amanha', "description" = E'Previsão de liberação do implemento é amanhã (fase de preparação, tarefa ainda não liberada).', "templates" = E'{"inApp":{"title":"Previsão de Liberação Amanhã","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação para amanhã{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."},"push":{"title":"Previsão de Liberação Amanhã","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista para amanhã"},"email":{"subject":"Previsão de Liberação Amanhã - {{taskName}}","body":"A tarefa tem previsão de liberação para amanhã{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação para amanhã{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."}}'::jsonb, "metadata" = E'{"registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.forecast_1day\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.forecast_1day';
UPDATE "NotificationConfiguration" SET "name" = E'Previsao de Liberacao em 3 Dias', "description" = E'Faltam 3 dias para a previsão de liberação do implemento (fase de preparação, tarefa ainda não liberada).', "templates" = E'{"inApp":{"title":"Previsão de Liberação em 3 Dias","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 3 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."},"push":{"title":"Previsão de Liberação em 3 Dias","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista em 3 dias"},"email":{"subject":"Previsão de Liberação em 3 Dias - {{taskName}}","body":"A tarefa tem previsão de liberação em 3 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 3 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."}}'::jsonb, "metadata" = E'{"registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.forecast_3days\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.forecast_3days';
UPDATE "NotificationConfiguration" SET "name" = E'Previsao de Liberacao em 7 Dias', "description" = E'Faltam 7 dias para a previsão de liberação do implemento (fase de preparação, tarefa ainda não liberada).', "templates" = E'{"inApp":{"title":"Previsão de Liberação em 7 Dias","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 7 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."},"push":{"title":"Previsão de Liberação em 7 Dias","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista em 7 dias"},"email":{"subject":"Previsão de Liberação em 7 Dias - {{taskName}}","body":"A tarefa tem previsão de liberação em 7 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 7 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."}}'::jsonb, "metadata" = E'{"registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.forecast_7days\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.forecast_7days';
UPDATE "NotificationConfiguration" SET "name" = E'Previsao de Liberacao Atrasada', "description" = E'Previsão de liberação do implemento estourada com a preparação ainda pendente; requer destravamento urgente.', "templates" = E'{"inApp":{"title":"Previsão de Liberação Atrasada","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} está com a previsão de liberação atrasada em {{daysOverdue}} dia(s) e a preparação ainda não foi concluída."},"push":{"title":"Liberação Atrasada","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação atrasada há {{daysOverdue}} dia(s)"},"email":{"subject":"[ATENÇÃO] Previsão de Liberação Atrasada - {{taskName}}","body":"A previsão de liberação desta tarefa está atrasada.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}Dias de atraso: {{daysOverdue}}\\n"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} está com a previsão de liberação atrasada em {{daysOverdue}} dia(s) e a preparação ainda não foi concluída."}}'::jsonb, "metadata" = E'{"registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.forecast_overdue\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.forecast_overdue';
UPDATE "NotificationConfiguration" SET "name" = E'Previsao de Liberacao Hoje', "description" = E'Previsão de liberação do implemento é hoje e a preparação ainda não foi concluída (aviso urgente).', "templates" = E'{"inApp":{"title":"Previsão de Liberação Hoje","body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação para HOJE{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."},"push":{"title":"Previsão de Liberação Hoje","body":"{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista para hoje"},"email":{"subject":"Previsão de Liberação Hoje - {{taskName}}","body":"A tarefa tem previsão de liberação para HOJE{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}"},"whatsapp":{"body":"A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação para HOJE{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída."}}'::jsonb, "metadata" = E'{"registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"task.forecast_today\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'task.forecast_today';
UPDATE "NotificationConfiguration" SET "name" = E'Solicitação de Movimentação de Implemento', "description" = E'Solicitação de movimentação de implemento entre vagas da garagem registrada, aguardando execução.', "templates" = E'{"inApp":{"title":"Solicitação de Movimentação","body":"Movimentação do implemento \\"{{taskName}}\\" solicitada: de {{fromSpot}} para {{toSpot}}."},"push":{"title":"Solicitação de Movimentação","body":"{{taskName}} — mover de {{fromSpot}} para {{toSpot}}"},"email":{"subject":"Solicitação de Movimentação - {{taskName}}","body":"Foi solicitada a movimentação do implemento \\"{{taskName}}\\" de {{fromSpot}} para {{toSpot}}."},"whatsapp":{"body":"🚛 Movimentação solicitada: \\"{{taskName}}\\" de {{fromSpot}} para {{toSpot}}."}}'::jsonb, "metadata" = E'{"category":"PRODUCTION","registry":"seed-notification-configs","trigger":"ver dispatchByConfiguration(\\"implement.movement_request\\") no código (emissor não anotado)","targeted":false}'::jsonb, "updatedAt" = now() WHERE "key" = 'implement.movement_request';

-- Avisos já enviados: as CHAVES do metadado (o texto enviado fica como foi).
UPDATE "Notification"
SET "metadata" = jsonb_set("metadata", '{configKey}', to_jsonb(pg_temp.implemento_chave("metadata"->>'configKey')))
WHERE "metadata"->>'configKey' LIKE 'task.field.truck.%' OR "metadata"->>'configKey' = 'truck.movement_request';

UPDATE "Notification"
SET "metadata" = jsonb_set("metadata", '{fieldName}', to_jsonb(pg_temp.implemento_campo("metadata"->>'fieldName')))
WHERE "metadata"->>'fieldName' LIKE 'truck.%';

UPDATE "Notification" SET "relatedEntityType" = 'IMPLEMENT' WHERE "relatedEntityType" = 'TRUCK';

-- 4. ATENÇÃO ──────────────────────────────────────────────────────────────────
UPDATE "AttentionAck" SET "entityType" = 'IMPLEMENT' WHERE "entityType" = 'TRUCK';

-- 5. PREFERÊNCIAS DE TELA ─────────────────────────────────────────────────────
-- Ids de coluna, filtros e presets que os clientes gravam com o nome antigo
-- (`truckCategory`, `truckSpot`, `truckCategories`, `truck.plate`…), pela regra
-- mecânica da NOMENCLATURA.md §1. SÓ o id composto: o valor exato "truck" é
-- nome de ícone (glifo) e fica.
CREATE OR REPLACE FUNCTION pg_temp.implemento_json(j jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $f$
  -- `hasTruck` ("tem caminhão") virou `implementIdentified` (série ∨ placa ∨
  -- chassi): com a DD1 toda tarefa tem implemento, então "tem" seria sempre sim.
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               replace(j::text, '"hasTruck"', '"implementIdentified"'),
               '"trucks([A-Z][A-Za-z0-9_]*)"', '"implements\1"', 'g'),
             '"truck([A-Z][A-Za-z0-9_]*)"', '"implement\1"', 'g'),
           '"truck\.', '"implement.', 'g')::jsonb
$f$;

UPDATE "Preferences" SET
  "dashboardLayoutWeb"    = pg_temp.implemento_json("dashboardLayoutWeb"),
  "dashboardLayoutMobile" = pg_temp.implemento_json("dashboardLayoutMobile"),
  "tableConfigsWeb"       = pg_temp.implemento_json("tableConfigsWeb"),
  "detailConfigsWeb"      = pg_temp.implemento_json("detailConfigsWeb"),
  "tableConfigsMobile"    = pg_temp.implemento_json("tableConfigsMobile"),
  "detailConfigsMobile"   = pg_temp.implemento_json("detailConfigsMobile")
WHERE concat_ws(' ', "dashboardLayoutWeb"::text, "dashboardLayoutMobile"::text, "tableConfigsWeb"::text,
                "detailConfigsWeb"::text, "tableConfigsMobile"::text, "detailConfigsMobile"::text)
      ~ '"(hasTruck|trucks?[A-Z][A-Za-z0-9_]*|truck\.[A-Za-z])';
