-- Avisos da porta traseira do implemento (P11b, R5/DD4): folhas (bipartida/
-- tripartida), varões e portinholas, disparados pela tarefa e por PUT /implements.
--
-- Fonte da verdade: prisma/scripts/seed-notification-configs.ts. Esta migration
-- só garante que as 3 configurações EXISTAM depois do deploy — sem elas o
-- dispatch descarta o evento. ON CONFLICT DO NOTHING: se o seed já rodou, nada muda.
-- Gerada a partir das linhas que o seed cria (mesmo texto, mesmos canais).

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'task.field.implement.rearDoorBarCount', 'Varões da Porta Traseira Alterados', 'PRODUCTION', 'task.field.implement.rearDoorBarCount', 'Quantidade de varões da porta traseira do implemento alterada (rastreador de campos da tarefa e PUT /implements).', true, 'NORMAL', true, false, 5, 60, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — varões da porta traseira: {{#if newValue}}{{newValue}}{{else}}não informada{{/if}}", "title": "Varões da Porta Traseira Alterados"}, "email": {"body": "A tarefa teve a quantidade de varões da porta traseira alterada.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}", "subject": "Varões da Porta Traseira Alterados - {{taskName}}"}, "inApp": {"body": "A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a quantidade de varões da porta traseira alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}.", "title": "Varões da Porta Traseira Alterados"}, "whatsapp": {"body": "A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a quantidade de varões da porta traseira alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."}}'::jsonb, '{"field": "implement.rearDoorBarCount", "trigger": "task.listener.ts (task.field.changed) — TaskFieldTrackerService e ImplementService.update", "category": "PRODUCTION", "registry": "seed-notification-configs", "targeted": false}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{ADMIN,DESIGNER,PRODUCTION}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'task.field.implement.rearDoorBarCount'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, false), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'task.field.implement.rearDoorBarCount'
ON CONFLICT ("configurationId", "channel") DO NOTHING;
INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'task.field.implement.rearDoorHatchCount', 'Portinholas da Porta Traseira Alteradas', 'PRODUCTION', 'task.field.implement.rearDoorHatchCount', 'Quantidade de portinholas da porta traseira do implemento alterada (rastreador de campos da tarefa e PUT /implements).', true, 'NORMAL', true, false, 5, 60, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — portinholas da porta traseira: {{#if newValue}}{{newValue}}{{else}}não informada{{/if}}", "title": "Portinholas da Porta Traseira Alteradas"}, "email": {"body": "A tarefa teve a quantidade de portinholas da porta traseira alterada.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}", "subject": "Portinholas da Porta Traseira Alteradas - {{taskName}}"}, "inApp": {"body": "A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a quantidade de portinholas da porta traseira alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}.", "title": "Portinholas da Porta Traseira Alteradas"}, "whatsapp": {"body": "A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a quantidade de portinholas da porta traseira alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."}}'::jsonb, '{"field": "implement.rearDoorHatchCount", "trigger": "task.listener.ts (task.field.changed) — TaskFieldTrackerService e ImplementService.update", "category": "PRODUCTION", "registry": "seed-notification-configs", "targeted": false}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{ADMIN,DESIGNER,PRODUCTION}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'task.field.implement.rearDoorHatchCount'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, false), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'task.field.implement.rearDoorHatchCount'
ON CONFLICT ("configurationId", "channel") DO NOTHING;
INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'task.field.implement.rearDoorLeaves', 'Folhas da Porta Traseira Alteradas', 'PRODUCTION', 'task.field.implement.rearDoorLeaves', 'Configuração da porta traseira do implemento (bipartida/tripartida) alterada (rastreador de campos da tarefa e PUT /implements).', true, 'NORMAL', true, false, 5, 60, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — porta traseira: {{#if newValue}}{{newValue}}{{else}}não informada{{/if}}", "title": "Folhas da Porta Traseira Alteradas"}, "email": {"body": "A tarefa teve a configuração da porta traseira (bipartida/tripartida) alterada.\\n\\nTarefa: {{taskName}}\\n{{#if serialNumber}}Número de Série: {{serialNumber}}\\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\\n{{/if}}", "subject": "Folhas da Porta Traseira Alteradas - {{taskName}}"}, "inApp": {"body": "A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a configuração da porta traseira (bipartida/tripartida) alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}.", "title": "Folhas da Porta Traseira Alteradas"}, "whatsapp": {"body": "A tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a configuração da porta traseira (bipartida/tripartida) alterada{{#if oldValue}} de \\"{{oldValue}}\\"{{/if}}{{#if newValue}} para \\"{{newValue}}\\"{{/if}}."}}'::jsonb, '{"field": "implement.rearDoorLeaves", "trigger": "task.listener.ts (task.field.changed) — TaskFieldTrackerService e ImplementService.update", "category": "PRODUCTION", "registry": "seed-notification-configs", "targeted": false}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{ADMIN,DESIGNER,PRODUCTION}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'task.field.implement.rearDoorLeaves'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, false), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'task.field.implement.rearDoorLeaves'
ON CONFLICT ("configurationId", "channel") DO NOTHING;
