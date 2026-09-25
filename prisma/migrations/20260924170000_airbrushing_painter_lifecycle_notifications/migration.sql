-- Avisos ao aerografista sobre o ciclo da aerografia dele: liberada para
-- produção, cancelada, transferida para outro e reaberta.
--
-- Fonte da verdade: prisma/scripts/seed-notification-configs.ts. Esta migration
-- só garante que as 4 configurações EXISTAM depois do deploy — sem elas o
-- dispatch descarta o evento. ON CONFLICT DO NOTHING: se o seed já rodou, nada muda.

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.cancelled', 'Aerografia Cancelada', 'PRODUCTION', 'airbrushing.cancelled', 'Uma aerografia designada ao aerografista foi cancelada (notificação direcionada ao aerografista designado).', true, 'HIGH', false, false, NULL, NULL, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — aerografia cancelada", "title": "Aerografia Cancelada"}, "email": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi cancelada.{{#if description}} Serviço: {{description}}.{{/if}}", "subject": "Aerografia Cancelada — {{taskName}}"}, "inApp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi cancelada.{{#if description}} Serviço: {{description}}.{{/if}}", "title": "Aerografia Cancelada"}, "whatsapp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi cancelada.{{#if description}} Serviço: {{description}}.{{/if}}"}}'::jsonb, '{"trigger": "AirbrushingNotificationService.registerIntent — create/update/batchCreate/batchUpdate do AirbrushingService e a seção de aerografia do TaskService.update", "registry": "seed-notification-configs", "targeted": true}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.cancelled'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.cancelled'
ON CONFLICT ("configurationId", "channel") DO NOTHING;

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.released', 'Aerografia Liberada para Produção', 'PRODUCTION', 'airbrushing.released', 'A aerografia do aerografista foi disponibilizada para produção (Aguardando Produção): ele já pode iniciar (notificação direcionada ao aerografista designado).', true, 'HIGH', false, false, NULL, NULL, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberada para produção", "title": "Aerografia Liberada para Produção"}, "email": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi liberada para produção. Você já pode iniciar.{{#if description}} Serviço: {{description}}.{{/if}}", "subject": "Aerografia Liberada para Produção — {{taskName}}"}, "inApp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi liberada para produção. Você já pode iniciar.{{#if description}} Serviço: {{description}}.{{/if}}", "title": "Aerografia Liberada para Produção"}, "whatsapp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi liberada para produção. Você já pode iniciar.{{#if description}} Serviço: {{description}}.{{/if}}"}}'::jsonb, '{"trigger": "AirbrushingNotificationService.registerIntent — create/update/batchCreate/batchUpdate do AirbrushingService e a seção de aerografia do TaskService.update", "registry": "seed-notification-configs", "targeted": true}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.released'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.released'
ON CONFLICT ("configurationId", "channel") DO NOTHING;

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.reopened', 'Aerografia Reaberta', 'PRODUCTION', 'airbrushing.reopened', 'Uma aerografia concluída do aerografista foi reaberta pela empresa (notificação direcionada ao aerografista designado).', true, 'HIGH', false, false, NULL, NULL, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — aerografia reaberta", "title": "Aerografia Reaberta"}, "email": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi reaberta{{#if statusLabel}} e voltou para {{statusLabel}}{{/if}}.", "subject": "Aerografia Reaberta — {{taskName}}"}, "inApp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi reaberta{{#if statusLabel}} e voltou para {{statusLabel}}{{/if}}.", "title": "Aerografia Reaberta"}, "whatsapp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi reaberta{{#if statusLabel}} e voltou para {{statusLabel}}{{/if}}."}}'::jsonb, '{"trigger": "AirbrushingNotificationService.registerIntent — create/update/batchCreate/batchUpdate do AirbrushingService e a seção de aerografia do TaskService.update", "registry": "seed-notification-configs", "targeted": true}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.reopened'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.reopened'
ON CONFLICT ("configurationId", "channel") DO NOTHING;

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.unassigned', 'Aerografia Transferida', 'PRODUCTION', 'airbrushing.unassigned', 'O aerografista deixou de ser o responsável pela aerografia — trocado por outro ou retirado (notificação direcionada ao aerografista anterior).', true, 'HIGH', false, false, NULL, NULL, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — aerografia transferida", "title": "Você Não É Mais o Responsável"}, "email": {"body": "Você não é mais o responsável pela aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}}.", "subject": "Você Não É Mais o Responsável — {{taskName}}"}, "inApp": {"body": "Você não é mais o responsável pela aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}}.", "title": "Você Não É Mais o Responsável"}, "whatsapp": {"body": "Você não é mais o responsável pela aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}}."}}'::jsonb, '{"trigger": "AirbrushingNotificationService.registerIntent — create/update/batchCreate/batchUpdate do AirbrushingService e a seção de aerografia do TaskService.update", "registry": "seed-notification-configs", "targeted": true}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.unassigned'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.unassigned'
ON CONFLICT ("configurationId", "channel") DO NOTHING;
