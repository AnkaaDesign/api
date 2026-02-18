-- ============================================================================
-- NOTIFICATION TEMPLATES UPDATE SCRIPT
-- ============================================================================
-- This script updates all NotificationConfiguration records with proper
-- templates including title and body for all channels (inApp, push, email).
--
-- Template Variables Available:
--   {{taskName}}             - Task name/title
--   {{serialNumber}}         - Task serial number (may be empty)
--   {{oldValue}}             - Previous field value
--   {{newValue}}             - New field value
--   {{changedBy}}            - Name of user who made the change
--   {{fieldName}}            - Name of the field that changed
--   {{count}}                - Number of items (for file arrays)
--   {{addedCount}}           - Number of files added (for file arrays)
--   {{removedCount}}         - Number of files removed (for file arrays)
--   {{fileChangeDescription}} - Formatted description of file changes (e.g., "1 arte adicionada e 2 artes removidas")
--   {{daysOverdue}}          - Days past deadline
--   {{daysRemaining}}        - Days until deadline
--   {{hoursRemaining}}       - Hours until deadline
--
-- Run this script against your database:
--   psql -d your_database -f update-notification-templates.sql
-- ============================================================================

-- ============================================================================
-- SECTION 1: TASK LIFECYCLE NOTIFICATIONS
-- ============================================================================

-- task.created
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Nova Tarefa Criada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} foi criada por {{changedBy}}."
  },
  "push": {
    "title": "Nova Tarefa",
    "body": "{{taskName}} {{serialNumber}} - Criada por {{changedBy}}"
  },
  "email": {
    "subject": "Nova Tarefa Criada - {{taskName}}",
    "body": "Uma nova tarefa foi criada no sistema.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nCriada por: {{changedBy}}\n\nAcesse o sistema para mais detalhes."
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.created';

-- task.waiting_production
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Tarefa Aguardando Producao",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} esta pronta e aguardando inicio da producao. Alterado por {{changedBy}}."
  },
  "push": {
    "title": "Aguardando Producao",
    "body": "{{taskName}} {{serialNumber}} - Pronta para producao"
  },
  "email": {
    "subject": "Tarefa Aguardando Producao - {{taskName}}",
    "body": "A tarefa esta pronta para iniciar a producao.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}\n\nStatus anterior: {{oldValue}}\nNovo status: {{newValue}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.waiting_production';

-- task.in_production
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Tarefa em Producao",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} entrou em producao. Iniciado por {{changedBy}}."
  },
  "push": {
    "title": "Em Producao",
    "body": "{{taskName}} {{serialNumber}} - Producao iniciada"
  },
  "email": {
    "subject": "Tarefa em Producao - {{taskName}}",
    "body": "A producao da tarefa foi iniciada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nIniciado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.in_production';

-- task.completed
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Tarefa Concluida",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} foi concluida com sucesso por {{changedBy}}."
  },
  "push": {
    "title": "Tarefa Concluida",
    "body": "{{taskName}} {{serialNumber}} - Finalizada"
  },
  "email": {
    "subject": "Tarefa Concluida - {{taskName}}",
    "body": "A tarefa foi concluida com sucesso.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nConcluida por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.completed';

-- task.ready_for_production
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Tarefa Liberada para Producao",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} foi liberada e esta pronta para iniciar a producao."
  },
  "push": {
    "title": "Liberada para Producao",
    "body": "{{taskName}} {{serialNumber}} - Pronta para iniciar"
  },
  "email": {
    "subject": "Tarefa Liberada - {{taskName}}",
    "body": "Uma tarefa foi liberada para producao.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\n\nA tarefa esta pronta para iniciar a producao."
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.ready_for_production';

-- ============================================================================
-- SECTION 2: TASK DEADLINE/OVERDUE NOTIFICATIONS
-- ============================================================================

-- task.overdue
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Tarefa Atrasada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} esta atrasada ha {{daysOverdue}} dia(s). Acao imediata necessaria."
  },
  "push": {
    "title": "ATRASADA: {{taskName}}",
    "body": "{{serialNumber}} - {{daysOverdue}} dia(s) de atraso"
  },
  "email": {
    "subject": "[URGENTE] Tarefa Atrasada - {{taskName}}",
    "body": "ATENCAO: Uma tarefa esta atrasada e requer acao imediata.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nDias de atraso: {{daysOverdue}}\n\nPor favor, verifique a situacao e tome as providencias necessarias."
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.overdue';

-- task.deadline_1hour
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Prazo em 1 Hora",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} vence em aproximadamente 1 hora. Finalize o trabalho."
  },
  "push": {
    "title": "URGENTE: 1h restante",
    "body": "{{taskName}} {{serialNumber}} - Vence em 1 hora"
  },
  "email": {
    "subject": "[URGENTE] Prazo em 1 Hora - {{taskName}}",
    "body": "ATENCAO: O prazo desta tarefa vence em 1 hora.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 1 hora"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.deadline_1hour';

-- task.deadline_4hours
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Prazo em 4 Horas",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} vence em aproximadamente 4 horas."
  },
  "push": {
    "title": "Prazo Proximo: 4h",
    "body": "{{taskName}} {{serialNumber}} - Vence em 4 horas"
  },
  "email": {
    "subject": "Prazo em 4 Horas - {{taskName}}",
    "body": "O prazo desta tarefa esta se aproximando.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 4 horas"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.deadline_4hours';

-- task.deadline_1day
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Prazo Amanha",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} vence amanha. Verifique o progresso."
  },
  "push": {
    "title": "Vence Amanha",
    "body": "{{taskName}} {{serialNumber}} - Prazo em 1 dia"
  },
  "email": {
    "subject": "Prazo Amanha - {{taskName}}",
    "body": "O prazo desta tarefa vence amanha.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 1 dia"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.deadline_1day';

-- task.deadline_3days
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Prazo em 3 Dias",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} vence em 3 dias."
  },
  "push": {
    "title": "Prazo em 3 Dias",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Prazo em 3 Dias - {{taskName}}",
    "body": "Lembrete de prazo.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 3 dias"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.deadline_3days';

-- task.deadline_7days
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Prazo em 7 Dias",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} vence em 7 dias."
  },
  "push": {
    "title": "Prazo em 1 Semana",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Prazo em 7 Dias - {{taskName}}",
    "body": "Lembrete de prazo.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 7 dias"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.deadline_7days';

-- ============================================================================
-- SECTION 3: TASK FORECAST NOTIFICATIONS
-- ============================================================================

-- task.forecast_today
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Previsao de Liberacao Hoje",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} tem previsao de liberacao para HOJE."
  },
  "push": {
    "title": "Liberacao Hoje",
    "body": "{{taskName}} {{serialNumber}} - Previsao para hoje"
  },
  "email": {
    "subject": "Previsao de Liberacao Hoje - {{taskName}}",
    "body": "A tarefa tem previsao de liberacao para hoje.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.forecast_today';

-- task.forecast_1day
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Previsao de Liberacao Amanha",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} tem previsao de liberacao para amanha."
  },
  "push": {
    "title": "Liberacao Amanha",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Previsao de Liberacao Amanha - {{taskName}}",
    "body": "A tarefa tem previsao de liberacao para amanha.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.forecast_1day';

-- task.forecast_3days
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Previsao de Liberacao em 3 Dias",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} tem previsao de liberacao em 3 dias."
  },
  "push": {
    "title": "Liberacao em 3 Dias",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Previsao de Liberacao em 3 Dias - {{taskName}}",
    "body": "A tarefa tem previsao de liberacao em 3 dias.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.forecast_3days';

-- task.forecast_7days
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Previsao de Liberacao em 7 Dias",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} tem previsao de liberacao em 7 dias."
  },
  "push": {
    "title": "Liberacao em 1 Semana",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Previsao de Liberacao em 7 Dias - {{taskName}}",
    "body": "A tarefa tem previsao de liberacao em 7 dias.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.forecast_7days';

-- task.forecast_10days
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Previsao de Liberacao em 10 Dias",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} tem previsao de liberacao em 10 dias."
  },
  "push": {
    "title": "Liberacao em 10 Dias",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Previsao de Liberacao em 10 Dias - {{taskName}}",
    "body": "A tarefa tem previsao de liberacao em 10 dias.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.forecast_10days';

-- task.forecast_overdue
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Previsao de Liberacao Atrasada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} esta com a previsao de liberacao atrasada em {{daysOverdue}} dia(s)."
  },
  "push": {
    "title": "Liberacao Atrasada",
    "body": "{{taskName}} {{serialNumber}} - {{daysOverdue}} dia(s) de atraso"
  },
  "email": {
    "subject": "[ATENCAO] Previsao de Liberacao Atrasada - {{taskName}}",
    "body": "A previsao de liberacao desta tarefa esta atrasada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nDias de atraso: {{daysOverdue}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.forecast_overdue';

-- ============================================================================
-- SECTION 4: TASK FIELD UPDATE NOTIFICATIONS
-- ============================================================================

-- task.field.status
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Status da Tarefa Alterado",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve o status alterado de \"{{oldValue}}\" para \"{{newValue}}\" por {{changedBy}}."
  },
  "push": {
    "title": "Status Alterado",
    "body": "{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}"
  },
  "email": {
    "subject": "Status Alterado - {{taskName}}",
    "body": "O status da tarefa foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nStatus anterior: {{oldValue}}\nNovo status: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.status';

-- task.field.forecastDate (Previsao de Liberacao)
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Previsao de Liberacao Atualizada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a previsao de liberacao alterada de {{oldValue}} para {{newValue}} por {{changedBy}}."
  },
  "push": {
    "title": "Previsao Atualizada",
    "body": "{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}"
  },
  "email": {
    "subject": "Previsao de Liberacao Atualizada - {{taskName}}",
    "body": "A previsao de liberacao foi atualizada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nData anterior: {{oldValue}}\nNova data: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.forecastDate';

-- task.field.term (Prazo)
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Prazo da Tarefa Alterado",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve o prazo alterado de {{oldValue}} para {{newValue}} por {{changedBy}}."
  },
  "push": {
    "title": "Prazo Alterado",
    "body": "{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}"
  },
  "email": {
    "subject": "Prazo Alterado - {{taskName}}",
    "body": "O prazo da tarefa foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nPrazo anterior: {{oldValue}}\nNovo prazo: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.term';

-- task.field.sectorId (Setor)
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Setor da Tarefa Alterado",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} foi transferida para outro setor por {{changedBy}}."
  },
  "push": {
    "title": "Setor Alterado",
    "body": "{{taskName}} {{serialNumber}} - Transferida de setor"
  },
  "email": {
    "subject": "Setor Alterado - {{taskName}}",
    "body": "A tarefa foi transferida para outro setor.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.sectorId';

-- task.field.priority
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Prioridade da Tarefa Alterada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a prioridade alterada de \"{{oldValue}}\" para \"{{newValue}}\" por {{changedBy}}."
  },
  "push": {
    "title": "Prioridade Alterada",
    "body": "{{taskName}} {{serialNumber}}: {{newValue}}"
  },
  "email": {
    "subject": "Prioridade Alterada - {{taskName}}",
    "body": "A prioridade da tarefa foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nPrioridade anterior: {{oldValue}}\nNova prioridade: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.priority';

-- task.field.details
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Detalhes da Tarefa Atualizados",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve os detalhes atualizados por {{changedBy}}."
  },
  "push": {
    "title": "Detalhes Atualizados",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Detalhes Atualizados - {{taskName}}",
    "body": "Os detalhes da tarefa foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.details';

-- task.field.observation
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Observacao da Tarefa Atualizada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve uma observacao atualizada por {{changedBy}}."
  },
  "push": {
    "title": "Observacao Atualizada",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Observacao Atualizada - {{taskName}}",
    "body": "Uma observacao da tarefa foi atualizada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.observation';

-- task.field.name
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Nome da Tarefa Alterado",
    "body": "A tarefa {{serialNumber}} teve o nome alterado de \"{{oldValue}}\" para \"{{newValue}}\" por {{changedBy}}."
  },
  "push": {
    "title": "Nome Alterado",
    "body": "{{serialNumber}}: {{oldValue}} -> {{newValue}}"
  },
  "email": {
    "subject": "Nome da Tarefa Alterado",
    "body": "O nome da tarefa foi alterado.\n\nIdentificador: {{serialNumber}}\nNome anterior: {{oldValue}}\nNovo nome: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.name';

-- task.field.serialNumber
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Numero de Serie Alterado",
    "body": "A tarefa \"{{taskName}}\" teve o numero de serie alterado de \"{{oldValue}}\" para \"{{newValue}}\" por {{changedBy}}."
  },
  "push": {
    "title": "Serie Alterada",
    "body": "{{taskName}}: {{oldValue}} -> {{newValue}}"
  },
  "email": {
    "subject": "Numero de Serie Alterado - {{taskName}}",
    "body": "O numero de serie foi alterado.\n\nTarefa: {{taskName}}\nNumero anterior: {{oldValue}}\nNovo numero: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.serialNumber';

-- task.field.customerId
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Cliente da Tarefa Alterado",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve o cliente alterado por {{changedBy}}."
  },
  "push": {
    "title": "Cliente Alterado",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Cliente Alterado - {{taskName}}",
    "body": "O cliente da tarefa foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.customerId';

-- task.field.paintId
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Tinta da Tarefa Alterada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a tinta alterada por {{changedBy}}."
  },
  "push": {
    "title": "Tinta Alterada",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Tinta Alterada - {{taskName}}",
    "body": "A tinta da tarefa foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.paintId';

-- task.field.entryDate
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Data de Entrada Alterada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a data de entrada alterada de {{oldValue}} para {{newValue}} por {{changedBy}}."
  },
  "push": {
    "title": "Data de Entrada",
    "body": "{{taskName}} {{serialNumber}}: {{newValue}}"
  },
  "email": {
    "subject": "Data de Entrada Alterada - {{taskName}}",
    "body": "A data de entrada foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nData anterior: {{oldValue}}\nNova data: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.entryDate';

-- task.field.startedAt
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Data de Inicio Alterada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a data de inicio alterada de {{oldValue}} para {{newValue}} por {{changedBy}}."
  },
  "push": {
    "title": "Data de Inicio",
    "body": "{{taskName}} {{serialNumber}}: {{newValue}}"
  },
  "email": {
    "subject": "Data de Inicio Alterada - {{taskName}}",
    "body": "A data de inicio foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nData anterior: {{oldValue}}\nNova data: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.startedAt';

-- task.field.finishedAt
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Data de Conclusao Alterada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a data de conclusao alterada de {{oldValue}} para {{newValue}} por {{changedBy}}."
  },
  "push": {
    "title": "Data de Conclusao",
    "body": "{{taskName}} {{serialNumber}}: {{newValue}}"
  },
  "email": {
    "subject": "Data de Conclusao Alterada - {{taskName}}",
    "body": "A data de conclusao foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nData anterior: {{oldValue}}\nNova data: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.finishedAt';

-- task.field.commission
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Comissao da Tarefa Alterada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a comissao alterada por {{changedBy}}."
  },
  "push": {
    "title": "Comissao Alterada",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Comissao Alterada - {{taskName}}",
    "body": "A comissao da tarefa foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.commission';

-- task.field.representatives
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Representantes da Tarefa Alterados",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve os representantes alterados por {{changedBy}}."
  },
  "push": {
    "title": "Representantes Alterados",
    "body": "{{taskName}} {{serialNumber}}"
  },
  "email": {
    "subject": "Representantes Alterados - {{taskName}}",
    "body": "Os representantes da tarefa foram alterados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.representatives';

-- ============================================================================
-- SECTION 5: TRUCK FIELD UPDATES
-- ============================================================================

-- task.field.truck.plate (Placa do Caminhao)
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Placa do Caminhao Alterada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a placa alterada de \"{{oldValue}}\" para \"{{newValue}}\" por {{changedBy}}."
  },
  "push": {
    "title": "Placa Alterada",
    "body": "{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}"
  },
  "email": {
    "subject": "Placa do Caminhao Alterada - {{taskName}}",
    "body": "A placa do caminhao foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nPlaca anterior: {{oldValue}}\nNova placa: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.truck.plate';

-- task.field.truck.chassisNumber (Chassi do Caminhao)
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Chassi do Caminhao Alterado",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve o chassi alterado de \"{{oldValue}}\" para \"{{newValue}}\" por {{changedBy}}."
  },
  "push": {
    "title": "Chassi Alterado",
    "body": "{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}"
  },
  "email": {
    "subject": "Chassi do Caminhao Alterado - {{taskName}}",
    "body": "O chassi do caminhao foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nChassi anterior: {{oldValue}}\nNovo chassi: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.truck.chassisNumber';

-- task.field.truck.category
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Categoria do Caminhao Alterada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a categoria do caminhao alterada de \"{{oldValue}}\" para \"{{newValue}}\" por {{changedBy}}."
  },
  "push": {
    "title": "Categoria Alterada",
    "body": "{{taskName}} {{serialNumber}}: {{newValue}}"
  },
  "email": {
    "subject": "Categoria do Caminhao Alterada - {{taskName}}",
    "body": "A categoria do caminhao foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nCategoria anterior: {{oldValue}}\nNova categoria: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.truck.category';

-- task.field.truck.implementType
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Tipo de Implemento Alterado",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve o tipo de implemento alterado de \"{{oldValue}}\" para \"{{newValue}}\" por {{changedBy}}."
  },
  "push": {
    "title": "Implemento Alterado",
    "body": "{{taskName}} {{serialNumber}}: {{newValue}}"
  },
  "email": {
    "subject": "Tipo de Implemento Alterado - {{taskName}}",
    "body": "O tipo de implemento foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTipo anterior: {{oldValue}}\nNovo tipo: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.truck.implementType';

-- task.field.truck.spot
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Vaga do Caminhao Alterada",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve a vaga alterada de \"{{oldValue}}\" para \"{{newValue}}\" por {{changedBy}}."
  },
  "push": {
    "title": "Vaga Alterada",
    "body": "{{taskName}} {{serialNumber}}: {{newValue}}"
  },
  "email": {
    "subject": "Vaga do Caminhao Alterada - {{taskName}}",
    "body": "A vaga do caminhao foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nVaga anterior: {{oldValue}}\nNova vaga: {{newValue}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.truck.spot';

-- ============================================================================
-- SECTION 6: LAYOUT UPDATES
-- ============================================================================

-- task.field.truck.leftSideLayoutId (Layout Lado Esquerdo)
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Layout Lado Esquerdo Alterado",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve o layout do lado esquerdo alterado por {{changedBy}}."
  },
  "push": {
    "title": "Layout Esquerdo",
    "body": "{{taskName}} {{serialNumber}} - Layout atualizado"
  },
  "email": {
    "subject": "Layout Lado Esquerdo Alterado - {{taskName}}",
    "body": "O layout do lado esquerdo foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.truck.leftSideLayoutId';

-- task.field.truck.rightSideLayoutId (Layout Lado Direito)
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Layout Lado Direito Alterado",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve o layout do lado direito alterado por {{changedBy}}."
  },
  "push": {
    "title": "Layout Direito",
    "body": "{{taskName}} {{serialNumber}} - Layout atualizado"
  },
  "email": {
    "subject": "Layout Lado Direito Alterado - {{taskName}}",
    "body": "O layout do lado direito foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.truck.rightSideLayoutId';

-- task.field.truck.backSideLayoutId (Layout Traseira)
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Layout Traseira Alterado",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve o layout da traseira alterado por {{changedBy}}."
  },
  "push": {
    "title": "Layout Traseira",
    "body": "{{taskName}} {{serialNumber}} - Layout atualizado"
  },
  "email": {
    "subject": "Layout Traseira Alterado - {{taskName}}",
    "body": "O layout da traseira foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.truck.backSideLayoutId';

-- ============================================================================
-- SECTION 7: FILE ARRAY UPDATES
-- ============================================================================

-- task.field.artworks
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Artes da Tarefa Atualizadas",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}."
  },
  "push": {
    "title": "Artes Atualizadas",
    "body": "{{taskName}} {{serialNumber}}: {{fileChangeDescription}}"
  },
  "email": {
    "subject": "Artes Atualizadas - {{taskName}}",
    "body": "Os arquivos de arte foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.artworks';

-- task.field.budgets
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Orcamentos da Tarefa Atualizados",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}."
  },
  "push": {
    "title": "Orcamentos Atualizados",
    "body": "{{taskName}} {{serialNumber}}: {{fileChangeDescription}}"
  },
  "email": {
    "subject": "Orcamentos Atualizados - {{taskName}}",
    "body": "Os arquivos de orcamento foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.budgets';

-- task.field.invoices
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Notas Fiscais da Tarefa Atualizadas",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}."
  },
  "push": {
    "title": "Notas Fiscais Atualizadas",
    "body": "{{taskName}} {{serialNumber}}: {{fileChangeDescription}}"
  },
  "email": {
    "subject": "Notas Fiscais Atualizadas - {{taskName}}",
    "body": "Os arquivos de nota fiscal foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.invoices';

-- task.field.receipts
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Recibos da Tarefa Atualizados",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}."
  },
  "push": {
    "title": "Recibos Atualizados",
    "body": "{{taskName}} {{serialNumber}}: {{fileChangeDescription}}"
  },
  "email": {
    "subject": "Recibos Atualizados - {{taskName}}",
    "body": "Os arquivos de recibo foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.receipts';

-- task.field.bankSlips
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Boletos da Tarefa Atualizados",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}."
  },
  "push": {
    "title": "Boletos Atualizados",
    "body": "{{taskName}} {{serialNumber}}: {{fileChangeDescription}}"
  },
  "email": {
    "subject": "Boletos Atualizados - {{taskName}}",
    "body": "Os arquivos de boleto foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.bankSlips';

-- task.field.baseFiles (Arquivos Base)
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Arquivos Base Atualizados",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}."
  },
  "push": {
    "title": "Arquivos Base",
    "body": "{{taskName}} {{serialNumber}}: {{fileChangeDescription}}"
  },
  "email": {
    "subject": "Arquivos Base Atualizados - {{taskName}}",
    "body": "Os arquivos base foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.baseFiles';

-- task.field.logoPaints
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Logos/Pinturas Atualizadas",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}."
  },
  "push": {
    "title": "Logos/Pinturas",
    "body": "{{taskName}} {{serialNumber}}: {{fileChangeDescription}}"
  },
  "email": {
    "subject": "Logos/Pinturas Atualizadas - {{taskName}}",
    "body": "Os arquivos de logos e pinturas foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.logoPaints';

-- task.field.reimbursements
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Reembolsos Atualizados",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}."
  },
  "push": {
    "title": "Reembolsos",
    "body": "{{taskName}} {{serialNumber}}: {{fileChangeDescription}}"
  },
  "email": {
    "subject": "Reembolsos Atualizados - {{taskName}}",
    "body": "Os arquivos de reembolso foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.reimbursements';

-- task.field.invoiceReimbursements
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Notas de Reembolso Atualizadas",
    "body": "A tarefa \"{{taskName}}\" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}."
  },
  "push": {
    "title": "Notas de Reembolso",
    "body": "{{taskName}} {{serialNumber}}: {{fileChangeDescription}}"
  },
  "email": {
    "subject": "Notas de Reembolso Atualizadas - {{taskName}}",
    "body": "Os arquivos de nota de reembolso foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'task.field.invoiceReimbursements';

-- ============================================================================
-- SECTION 8: SERVICE ORDER NOTIFICATIONS (All Types)
-- Using DO block to generate all combinations
-- ============================================================================

DO $$
DECLARE
    so_types TEXT[] := ARRAY['production', 'financial', 'commercial', 'artwork', 'logistic'];
    so_type_labels TEXT[] := ARRAY['Producao', 'Financeira', 'Comercial', 'Arte', 'Logistica'];
    so_type TEXT;
    so_label TEXT;
    i INT;
BEGIN
    FOR i IN 1..5 LOOP
        so_type := so_types[i];
        so_label := so_type_labels[i];

        -- service_order.created.<type>
        UPDATE "NotificationConfiguration"
        SET "templates" = format('{
          "inApp": {
            "title": "Ordem de Servico %s Criada",
            "body": "Uma ordem de servico de %s foi criada para a tarefa \"{{taskName}}\" {{serialNumber}} por {{createdBy}}. Descricao: {{description}}"
          },
          "push": {
            "title": "Nova OS %s",
            "body": "{{taskName}} {{serialNumber}}: {{description}}"
          },
          "email": {
            "subject": "Nova Ordem de Servico %s - {{taskName}}",
            "body": "Uma nova ordem de servico foi criada.\n\nTipo: %s\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nDescricao: {{description}}\nCriada por: {{createdBy}}"
          }
        }', so_label, so_label, so_label, so_label, so_label)::jsonb,
            "updatedAt" = NOW()
        WHERE "key" = 'service_order.created.' || so_type;

        -- service_order.assigned.<type>
        UPDATE "NotificationConfiguration"
        SET "templates" = format('{
          "inApp": {
            "title": "Ordem de Servico %s Atribuida",
            "body": "A ordem de servico \"{{description}}\" da tarefa \"{{taskName}}\" foi atribuida a {{assignedTo}} por {{assignedBy}}."
          },
          "push": {
            "title": "OS Atribuida",
            "body": "{{taskName}}: {{description}} -> {{assignedTo}}"
          },
          "email": {
            "subject": "Ordem de Servico Atribuida - {{taskName}}",
            "body": "Uma ordem de servico foi atribuida.\n\nTipo: %s\nTarefa: {{taskName}}\nDescricao: {{description}}\nAtribuida a: {{assignedTo}}\nAtribuida por: {{assignedBy}}"
          }
        }', so_label, so_label)::jsonb,
            "updatedAt" = NOW()
        WHERE "key" = 'service_order.assigned.' || so_type;

        -- service_order.started.<type>
        UPDATE "NotificationConfiguration"
        SET "templates" = format('{
          "inApp": {
            "title": "Ordem de Servico %s Iniciada",
            "body": "A ordem de servico \"{{description}}\" da tarefa \"{{taskName}}\" {{serialNumber}} foi iniciada por {{changedBy}}."
          },
          "push": {
            "title": "OS Iniciada",
            "body": "{{taskName}} {{serialNumber}}: {{description}}"
          },
          "email": {
            "subject": "Ordem de Servico Iniciada - {{taskName}}",
            "body": "Uma ordem de servico foi iniciada.\n\nTipo: %s\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nDescricao: {{description}}\nIniciada por: {{changedBy}}"
          }
        }', so_label, so_label)::jsonb,
            "updatedAt" = NOW()
        WHERE "key" = 'service_order.started.' || so_type;

        -- service_order.waiting_approval.<type>
        UPDATE "NotificationConfiguration"
        SET "templates" = format('{
          "inApp": {
            "title": "OS %s Aguardando Aprovacao",
            "body": "A ordem de servico \"{{description}}\" da tarefa \"{{taskName}}\" {{serialNumber}} esta aguardando aprovacao."
          },
          "push": {
            "title": "OS Aguardando Aprovacao",
            "body": "{{taskName}} {{serialNumber}}: {{description}}"
          },
          "email": {
            "subject": "OS Aguardando Aprovacao - {{taskName}}",
            "body": "Uma ordem de servico esta aguardando aprovacao.\n\nTipo: %s\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nDescricao: {{description}}"
          }
        }', so_label, so_label)::jsonb,
            "updatedAt" = NOW()
        WHERE "key" = 'service_order.waiting_approval.' || so_type;

        -- service_order.completed.<type>
        UPDATE "NotificationConfiguration"
        SET "templates" = format('{
          "inApp": {
            "title": "Ordem de Servico %s Concluida",
            "body": "A ordem de servico \"{{description}}\" da tarefa \"{{taskName}}\" {{serialNumber}} foi concluida por {{changedBy}}."
          },
          "push": {
            "title": "OS Concluida",
            "body": "{{taskName}} {{serialNumber}}: {{description}}"
          },
          "email": {
            "subject": "Ordem de Servico Concluida - {{taskName}}",
            "body": "Uma ordem de servico foi concluida.\n\nTipo: %s\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nDescricao: {{description}}\nConcluida por: {{changedBy}}"
          }
        }', so_label, so_label)::jsonb,
            "updatedAt" = NOW()
        WHERE "key" = 'service_order.completed.' || so_type;

        -- service_order.cancelled.<type>
        UPDATE "NotificationConfiguration"
        SET "templates" = format('{
          "inApp": {
            "title": "Ordem de Servico %s Cancelada",
            "body": "A ordem de servico \"{{description}}\" da tarefa \"{{taskName}}\" {{serialNumber}} foi cancelada por {{changedBy}}."
          },
          "push": {
            "title": "OS Cancelada",
            "body": "{{taskName}} {{serialNumber}}: {{description}}"
          },
          "email": {
            "subject": "Ordem de Servico Cancelada - {{taskName}}",
            "body": "Uma ordem de servico foi cancelada.\n\nTipo: %s\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nDescricao: {{description}}\nCancelada por: {{changedBy}}"
          }
        }', so_label, so_label)::jsonb,
            "updatedAt" = NOW()
        WHERE "key" = 'service_order.cancelled.' || so_type;

        -- service_order.status_changed_for_creator.<type>
        UPDATE "NotificationConfiguration"
        SET "templates" = format('{
          "inApp": {
            "title": "Status da OS %s Alterado",
            "body": "A ordem de servico \"{{description}}\" da tarefa \"{{taskName}}\" teve o status alterado de \"{{oldStatus}}\" para \"{{newStatus}}\" por {{changedBy}}."
          },
          "push": {
            "title": "Status OS Alterado",
            "body": "{{taskName}}: {{description}} - {{newStatus}}"
          },
          "email": {
            "subject": "Status da OS Alterado - {{taskName}}",
            "body": "O status de uma ordem de servico foi alterado.\n\nTipo: %s\nTarefa: {{taskName}}\nDescricao: {{description}}\nStatus anterior: {{oldStatus}}\nNovo status: {{newStatus}}\nAlterado por: {{changedBy}}"
          }
        }', so_label, so_label)::jsonb,
            "updatedAt" = NOW()
        WHERE "key" = 'service_order.status_changed_for_creator.' || so_type;

        -- service_order.observation_changed.<type>
        UPDATE "NotificationConfiguration"
        SET "templates" = format('{
          "inApp": {
            "title": "Observacao da OS %s Alterada",
            "body": "A ordem de servico \"{{description}}\" da tarefa \"{{taskName}}\" teve a observacao alterada por {{changedBy}}."
          },
          "push": {
            "title": "Observacao OS",
            "body": "{{taskName}}: {{description}}"
          },
          "email": {
            "subject": "Observacao da OS Alterada - {{taskName}}",
            "body": "A observacao de uma ordem de servico foi alterada.\n\nTipo: %s\nTarefa: {{taskName}}\nDescricao: {{description}}\nObservacao anterior: {{oldObservation}}\nNova observacao: {{newObservation}}\nAlterado por: {{changedBy}}"
          }
        }', so_label, so_label)::jsonb,
            "updatedAt" = NOW()
        WHERE "key" = 'service_order.observation_changed.' || so_type;

    END LOOP;
END $$;

-- ============================================================================
-- SECTION 9: CUT NOTIFICATIONS
-- ============================================================================

-- cut.created
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Recorte Criado",
    "body": "Um recorte de {{cutTypeLabel}} foi criado para a tarefa \"{{taskName}}\" {{serialNumber}} por {{changedBy}}."
  },
  "push": {
    "title": "Novo Recorte",
    "body": "{{taskName}} {{serialNumber}}: {{cutTypeLabel}}"
  },
  "email": {
    "subject": "Novo Recorte - {{taskName}}",
    "body": "Um novo recorte foi criado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTipo: {{cutTypeLabel}}\nCriado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'cut.created';

-- cut.started
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Recorte Iniciado",
    "body": "O recorte de {{cutTypeLabel}} da tarefa \"{{taskName}}\" {{serialNumber}} foi iniciado por {{changedBy}}."
  },
  "push": {
    "title": "Recorte Iniciado",
    "body": "{{taskName}} {{serialNumber}}: {{cutTypeLabel}}"
  },
  "email": {
    "subject": "Recorte Iniciado - {{taskName}}",
    "body": "Um recorte foi iniciado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTipo: {{cutTypeLabel}}\nIniciado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'cut.started';

-- cut.completed
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Recorte Concluido",
    "body": "O recorte de {{cutTypeLabel}} da tarefa \"{{taskName}}\" {{serialNumber}} foi concluido por {{changedBy}}."
  },
  "push": {
    "title": "Recorte Concluido",
    "body": "{{taskName}} {{serialNumber}}: {{cutTypeLabel}}"
  },
  "email": {
    "subject": "Recorte Concluido - {{taskName}}",
    "body": "Um recorte foi concluido.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTipo: {{cutTypeLabel}}\nConcluido por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'cut.completed';

-- cut.request.created
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Novo Recorte Solicitado",
    "body": "Um novo recorte de {{cutTypeLabel}} foi solicitado para a tarefa \"{{taskName}}\" {{serialNumber}} por {{changedBy}}. Motivo: {{reason}}"
  },
  "push": {
    "title": "Recorte Solicitado",
    "body": "{{taskName}} {{serialNumber}}: {{cutTypeLabel}} - {{reason}}"
  },
  "email": {
    "subject": "Novo Recorte Solicitado - {{taskName}}",
    "body": "Um novo recorte foi solicitado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTipo: {{cutTypeLabel}}\nMotivo: {{reason}}\nSolicitado por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'cut.request.created';

-- cuts.added.to.task
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Recortes Adicionados",
    "body": "{{count}} recorte(s) foram adicionados a tarefa \"{{taskName}}\" {{serialNumber}} por {{changedBy}}."
  },
  "push": {
    "title": "Recortes Adicionados",
    "body": "{{taskName}} {{serialNumber}}: {{count}} recorte(s)"
  },
  "email": {
    "subject": "Recortes Adicionados - {{taskName}}",
    "body": "Recortes foram adicionados a uma tarefa.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nQuantidade: {{count}} recorte(s)\nAdicionados por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'cuts.added.to.task';

-- ============================================================================
-- SECTION 10: ARTWORK NOTIFICATIONS
-- ============================================================================

-- artwork.approved
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Arte Aprovada",
    "body": "A arte da tarefa \"{{taskName}}\" {{serialNumber}} foi aprovada por {{changedBy}}. Pronta para producao."
  },
  "push": {
    "title": "Arte Aprovada",
    "body": "{{taskName}} {{serialNumber}} - Aprovada"
  },
  "email": {
    "subject": "Arte Aprovada - {{taskName}}",
    "body": "A arte foi aprovada e esta pronta para producao.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAprovada por: {{changedBy}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'artwork.approved';

-- artwork.reproved
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Arte Reprovada",
    "body": "A arte da tarefa \"{{taskName}}\" {{serialNumber}} foi reprovada por {{changedBy}}. Motivo: {{reason}}"
  },
  "push": {
    "title": "Arte Reprovada",
    "body": "{{taskName}} {{serialNumber}} - Reprovada"
  },
  "email": {
    "subject": "Arte Reprovada - {{taskName}}",
    "body": "A arte foi reprovada e precisa de ajustes.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nReprovada por: {{changedBy}}\nMotivo: {{reason}}"
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'artwork.reproved';

-- artwork.pending_approval_reminder
UPDATE "NotificationConfiguration"
SET "templates" = '{
  "inApp": {
    "title": "Lembrete: Arte Aguardando Aprovacao",
    "body": "A arte da tarefa \"{{taskName}}\" {{serialNumber}} esta aguardando aprovacao ha {{daysText}}."
  },
  "push": {
    "title": "Arte Aguardando",
    "body": "{{taskName}} {{serialNumber}} - {{daysText}}"
  },
  "email": {
    "subject": "Lembrete: Arte Aguardando Aprovacao - {{taskName}}",
    "body": "Uma arte esta aguardando aprovacao.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo aguardando: {{daysText}}\n\nPor favor, revise e aprove ou reprove a arte."
  }
}'::jsonb,
    "updatedAt" = NOW()
WHERE "key" = 'artwork.pending_approval_reminder';

-- ============================================================================
-- VERIFICATION: Show updated records count
-- ============================================================================

SELECT
    'Templates atualizados com sucesso!' AS status,
    COUNT(*) AS total_updated
FROM "NotificationConfiguration"
WHERE "templates" IS NOT NULL
  AND "templates" != '{}'::jsonb
  AND "templates"->>'inApp' IS NOT NULL;
