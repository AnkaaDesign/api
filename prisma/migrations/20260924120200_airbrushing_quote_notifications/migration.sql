-- Notificações da cotação da aerografia.
--
-- A fonte da verdade é prisma/scripts/seed-notification-configs.ts (registry
-- `airbrushing.quote.*`). Esta migration só garante que as 7 configurações
-- EXISTAM depois do deploy, sem depender de alguém rodar o seed à mão — sem
-- elas o dispatch descarta o evento com "No database configuration found".
-- ON CONFLICT DO NOTHING: se o seed já rodou, não toca em nada.

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.quote.accepted', 'Contraproposta de Aerografia Aceita', 'PRODUCTION', 'airbrushing.quote.accepted', 'O aerografista aceitou a contraproposta. Aceitar não seleciona: a escolha entre os que aceitaram continua com o comercial.', true, 'HIGH', false, false, NULL, NULL, E'{"push": {"body": "{{painterName}} aceitou {{amount}} — {{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}", "title": "Contraproposta Aceita"}, "email": {"body": "{{painterName}} aceitou fazer a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} por {{amount}}.{{#if note}} Observação: {{note}}{{/if}} Selecione o aerografista para fechar a cotação.", "subject": "Contraproposta Aceita — {{taskName}}"}, "inApp": {"body": "{{painterName}} aceitou fazer a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} por {{amount}}.{{#if note}} Observação: {{note}}{{/if}} Selecione o aerografista para fechar a cotação.", "title": "Contraproposta Aceita"}, "whatsapp": {"body": "{{painterName}} aceitou fazer a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} por {{amount}}.{{#if note}} Observação: {{note}}{{/if}} Selecione o aerografista para fechar a cotação."}}'::jsonb, '{"trigger": "AirbrushingQuoteService.accept", "registry": "seed-notification-configs", "targeted": false}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{ADMIN,COMMERCIAL}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.quote.accepted'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.quote.accepted'
ON CONFLICT ("configurationId", "channel") DO NOTHING;

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.quote.closed', 'Cotação de Aerografia Encerrada', 'PRODUCTION', 'airbrushing.quote.closed', 'A cotação terminou sem a proposta do aerografista — outra foi selecionada ou o serviço foi cancelado (notificação direcionada aos demais participantes).', true, 'NORMAL', false, false, NULL, NULL, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — cotação encerrada", "title": "Cotação Encerrada"}, "email": {"body": "A cotação da aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi encerrada: {{reason}}.", "subject": "Cotação Encerrada — {{taskName}}"}, "inApp": {"body": "A cotação da aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi encerrada: {{reason}}.", "title": "Cotação Encerrada"}, "whatsapp": {"body": "A cotação da aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi encerrada: {{reason}}."}}'::jsonb, '{"trigger": "AirbrushingQuoteService.select / cancelamento da aerografia em cotação", "registry": "seed-notification-configs", "targeted": true}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.quote.closed'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.quote.closed'
ON CONFLICT ("configurationId", "channel") DO NOTHING;

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.quote.countered', 'Contraproposta de Aerografia', 'PRODUCTION', 'airbrushing.quote.countered', 'O comercial respondeu à proposta do aerografista com outro valor (notificação direcionada ao aerografista da proposta).', true, 'HIGH', false, false, NULL, NULL, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — contraproposta de {{amount}}", "title": "Contraproposta Recebida"}, "email": {"body": "Você recebeu uma contraproposta de {{amount}} para a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.{{#if note}} Observação: {{note}}{{/if}} Aceite, recuse ou envie outro valor.", "subject": "Contraproposta Recebida — {{taskName}}"}, "inApp": {"body": "Você recebeu uma contraproposta de {{amount}} para a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.{{#if note}} Observação: {{note}}{{/if}} Aceite, recuse ou envie outro valor.", "title": "Contraproposta Recebida"}, "whatsapp": {"body": "Você recebeu uma contraproposta de {{amount}} para a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.{{#if note}} Observação: {{note}}{{/if}} Aceite, recuse ou envie outro valor."}}'::jsonb, '{"trigger": "AirbrushingQuoteService.counter", "registry": "seed-notification-configs", "targeted": true}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.quote.countered'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.quote.countered'
ON CONFLICT ("configurationId", "channel") DO NOTHING;

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.quote.declined', 'Aerografia Recusada pelo Aerografista', 'PRODUCTION', 'airbrushing.quote.declined', 'Um aerografista recusou uma aerografia em cotação (sem interesse ou discordando da contraproposta).', true, 'NORMAL', false, false, NULL, NULL, E'{"push": {"body": "{{painterName}} recusou — {{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}", "title": "Aerografista Recusou"}, "email": {"body": "{{painterName}} recusou a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.{{#if note}} Motivo: {{note}}{{/if}}", "subject": "Aerografista Recusou — {{taskName}}"}, "inApp": {"body": "{{painterName}} recusou a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.{{#if note}} Motivo: {{note}}{{/if}}", "title": "Aerografista Recusou"}, "whatsapp": {"body": "{{painterName}} recusou a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.{{#if note}} Motivo: {{note}}{{/if}}"}}'::jsonb, '{"trigger": "AirbrushingQuoteService.decline", "registry": "seed-notification-configs", "targeted": false}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{ADMIN,COMMERCIAL}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.quote.declined'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.quote.declined'
ON CONFLICT ("configurationId", "channel") DO NOTHING;

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.quote.proposed', 'Proposta de Aerografia Recebida', 'PRODUCTION', 'airbrushing.quote.proposed', 'Um aerografista enviou (ou revisou) o valor de uma aerografia em cotação, inclusive em resposta a uma contraproposta.', true, 'HIGH', false, false, NULL, NULL, E'{"push": {"body": "{{painterName}}: {{amount}} — {{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}", "title": "Proposta de Aerografia Recebida"}, "email": {"body": "{{painterName}} propôs {{amount}} para a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}}.{{#if note}} Observação: {{note}}{{/if}}", "subject": "Proposta de Aerografia Recebida — {{taskName}}"}, "inApp": {"body": "{{painterName}} propôs {{amount}} para a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}}.{{#if note}} Observação: {{note}}{{/if}}", "title": "Proposta de Aerografia Recebida"}, "whatsapp": {"body": "{{painterName}} propôs {{amount}} para a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}}.{{#if note}} Observação: {{note}}{{/if}}"}}'::jsonb, '{"trigger": "AirbrushingQuoteService.propose", "registry": "seed-notification-configs", "targeted": false}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{ADMIN,COMMERCIAL}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.quote.proposed'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.quote.proposed'
ON CONFLICT ("configurationId", "channel") DO NOTHING;

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.quote.requested', 'Novo Serviço para Cotar', 'PRODUCTION', 'airbrushing.quote.requested', 'Aerografia criada sem aerografista entrou em cotação: os aerografistas enviam o valor pelo qual fazem o serviço.', true, 'HIGH', false, false, NULL, NULL, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — aerografia aguardando sua proposta", "title": "Novo Serviço para Cotar"}, "email": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} está em cotação.{{#if description}} Serviço: {{description}}.{{/if}} Envie o seu valor pelo app.", "subject": "Novo Serviço para Cotar — {{taskName}}"}, "inApp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} está em cotação.{{#if description}} Serviço: {{description}}.{{/if}} Envie o seu valor pelo app.", "title": "Novo Serviço para Cotar"}, "whatsapp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} está em cotação.{{#if description}} Serviço: {{description}}.{{/if}} Envie o seu valor pelo app."}}'::jsonb, '{"trigger": "AirbrushingQuoteNotificationService.notifyPendingRequests — pós-commit da criação e varredura do AirbrushingQuoteScheduler", "registry": "seed-notification-configs", "targeted": false}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{AIRBRUSHING}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.quote.requested'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.quote.requested'
ON CONFLICT ("configurationId", "channel") DO NOTHING;

INSERT INTO "NotificationConfiguration" ("id","key","name","notificationType","eventType","description","enabled","importance","workHoursOnly","batchingEnabled","maxFrequencyPerDay","deduplicationWindow","templates","metadata","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'airbrushing.quote.selected', 'Proposta de Aerografia Selecionada', 'PRODUCTION', 'airbrushing.quote.selected', 'A proposta do aerografista foi escolhida: ele passa a ser o responsável pela aerografia, pelo valor combinado (notificação direcionada ao aerografista selecionado).', true, 'HIGH', false, false, NULL, NULL, E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — proposta de {{amount}} selecionada", "title": "Sua Proposta Foi Selecionada"}, "email": {"body": "Sua proposta de {{amount}} para a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi selecionada. O serviço agora é seu.", "subject": "Sua Proposta Foi Selecionada — {{taskName}}"}, "inApp": {"body": "Sua proposta de {{amount}} para a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi selecionada. O serviço agora é seu.", "title": "Sua Proposta Foi Selecionada"}, "whatsapp": {"body": "Sua proposta de {{amount}} para a aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} foi selecionada. O serviço agora é seu."}}'::jsonb, '{"trigger": "AirbrushingQuoteService.select", "registry": "seed-notification-configs", "targeted": true}'::jsonb, now(), now())
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "NotificationTargetRule" ("id","configurationId","allowedSectors","excludeOnVacation","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", '{}'::"SectorPrivileges"[], true, now(), now()
FROM "NotificationConfiguration" c WHERE c."key" = 'airbrushing.quote.selected'
ON CONFLICT ("configurationId") DO NOTHING;
INSERT INTO "NotificationChannelConfig" ("id","configurationId","channel","enabled","mandatory","defaultOn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", v.channel::"NotificationChannel", v.enabled, v.mandatory, v."defaultOn", now(), now()
FROM "NotificationConfiguration" c
CROSS JOIN (VALUES ('IN_APP', true, false, true), ('PUSH', true, false, true), ('EMAIL', false, false, false), ('WHATSAPP', false, false, false)) AS v(channel, enabled, mandatory, "defaultOn")
WHERE c."key" = 'airbrushing.quote.selected'
ON CONFLICT ("configurationId", "channel") DO NOTHING;
