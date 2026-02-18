/**
 * =============================================================================
 * NOTIFICATION TEMPLATES UPDATE SCRIPT
 * =============================================================================
 *
 * This script updates all NotificationConfiguration records with proper
 * templates including title and body for all channels (inApp, push, email).
 *
 * Run with: npx ts-node prisma/scripts/update-notification-templates.ts
 * Or: npx tsx prisma/scripts/update-notification-templates.ts
 *
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface NotificationTemplate {
  inApp?: { title: string; body: string };
  push?: { title: string; body: string };
  email?: { subject: string; body: string };
  whatsapp?: { body: string };
}

interface TemplateConfig {
  key: string;
  name: string;
  templates: NotificationTemplate;
}

// =============================================================================
// TEMPLATE DEFINITIONS
// =============================================================================

const TASK_LIFECYCLE_TEMPLATES: TemplateConfig[] = [
  {
    key: 'task.created',
    name: 'Nova Tarefa Criada',
    templates: {
      inApp: {
        title: 'Nova Tarefa Criada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} foi criada por {{changedBy}}.',
      },
      push: {
        title: 'Nova Tarefa',
        body: '{{taskName}} {{serialNumber}} - Criada por {{changedBy}}',
      },
      email: {
        subject: 'Nova Tarefa Criada - {{taskName}}',
        body: 'Uma nova tarefa foi criada no sistema.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nCriada por: {{changedBy}}\n\nAcesse o sistema para mais detalhes.',
      },
    },
  },
  {
    key: 'task.waiting_production',
    name: 'Tarefa Aguardando Producao',
    templates: {
      inApp: {
        title: 'Tarefa Aguardando Producao',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} esta pronta e aguardando inicio da producao. Alterado por {{changedBy}}.',
      },
      push: {
        title: 'Aguardando Producao',
        body: '{{taskName}} {{serialNumber}} - Pronta para producao',
      },
      email: {
        subject: 'Tarefa Aguardando Producao - {{taskName}}',
        body: 'A tarefa esta pronta para iniciar a producao.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}\n\nStatus anterior: {{oldValue}}\nNovo status: {{newValue}}',
      },
    },
  },
  {
    key: 'task.in_production',
    name: 'Tarefa em Producao',
    templates: {
      inApp: {
        title: 'Tarefa em Producao',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} entrou em producao. Iniciado por {{changedBy}}.',
      },
      push: {
        title: 'Em Producao',
        body: '{{taskName}} {{serialNumber}} - Producao iniciada',
      },
      email: {
        subject: 'Tarefa em Producao - {{taskName}}',
        body: 'A producao da tarefa foi iniciada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nIniciado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.completed',
    name: 'Tarefa Concluida',
    templates: {
      inApp: {
        title: 'Tarefa Concluida',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} foi concluida com sucesso por {{changedBy}}.',
      },
      push: {
        title: 'Tarefa Concluida',
        body: '{{taskName}} {{serialNumber}} - Finalizada',
      },
      email: {
        subject: 'Tarefa Concluida - {{taskName}}',
        body: 'A tarefa foi concluida com sucesso.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nConcluida por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.ready_for_production',
    name: 'Tarefa Liberada para Producao',
    templates: {
      inApp: {
        title: 'Tarefa Liberada para Producao',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} foi liberada e esta pronta para iniciar a producao.',
      },
      push: {
        title: 'Liberada para Producao',
        body: '{{taskName}} {{serialNumber}} - Pronta para iniciar',
      },
      email: {
        subject: 'Tarefa Liberada - {{taskName}}',
        body: 'Uma tarefa foi liberada para producao.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\n\nA tarefa esta pronta para iniciar a producao.',
      },
    },
  },
];

const TASK_DEADLINE_TEMPLATES: TemplateConfig[] = [
  {
    key: 'task.overdue',
    name: 'Tarefa Atrasada',
    templates: {
      inApp: {
        title: 'Tarefa Atrasada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} esta atrasada ha {{daysOverdue}} dia(s). Acao imediata necessaria.',
      },
      push: {
        title: 'ATRASADA: {{taskName}}',
        body: '{{serialNumber}} - {{daysOverdue}} dia(s) de atraso',
      },
      email: {
        subject: '[URGENTE] Tarefa Atrasada - {{taskName}}',
        body: 'ATENCAO: Uma tarefa esta atrasada e requer acao imediata.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nDias de atraso: {{daysOverdue}}\n\nPor favor, verifique a situacao e tome as providencias necessarias.',
      },
    },
  },
  {
    key: 'task.deadline_1hour',
    name: 'Prazo em 1 Hora',
    templates: {
      inApp: {
        title: 'Prazo em 1 Hora',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} vence em aproximadamente 1 hora. Finalize o trabalho.',
      },
      push: {
        title: 'URGENTE: 1h restante',
        body: '{{taskName}} {{serialNumber}} - Vence em 1 hora',
      },
      email: {
        subject: '[URGENTE] Prazo em 1 Hora - {{taskName}}',
        body: 'ATENCAO: O prazo desta tarefa vence em 1 hora.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 1 hora',
      },
    },
  },
  {
    key: 'task.deadline_4hours',
    name: 'Prazo em 4 Horas',
    templates: {
      inApp: {
        title: 'Prazo em 4 Horas',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} vence em aproximadamente 4 horas.',
      },
      push: {
        title: 'Prazo Proximo: 4h',
        body: '{{taskName}} {{serialNumber}} - Vence em 4 horas',
      },
      email: {
        subject: 'Prazo em 4 Horas - {{taskName}}',
        body: 'O prazo desta tarefa esta se aproximando.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 4 horas',
      },
    },
  },
  {
    key: 'task.deadline_1day',
    name: 'Prazo Amanha',
    templates: {
      inApp: {
        title: 'Prazo Amanha',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} vence amanha. Verifique o progresso.',
      },
      push: {
        title: 'Vence Amanha',
        body: '{{taskName}} {{serialNumber}} - Prazo em 1 dia',
      },
      email: {
        subject: 'Prazo Amanha - {{taskName}}',
        body: 'O prazo desta tarefa vence amanha.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 1 dia',
      },
    },
  },
  {
    key: 'task.deadline_3days',
    name: 'Prazo em 3 Dias',
    templates: {
      inApp: {
        title: 'Prazo em 3 Dias',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} vence em 3 dias.',
      },
      push: {
        title: 'Prazo em 3 Dias',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Prazo em 3 Dias - {{taskName}}',
        body: 'Lembrete de prazo.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 3 dias',
      },
    },
  },
  {
    key: 'task.deadline_7days',
    name: 'Prazo em 7 Dias',
    templates: {
      inApp: {
        title: 'Prazo em 7 Dias',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} vence em 7 dias.',
      },
      push: {
        title: 'Prazo em 1 Semana',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Prazo em 7 Dias - {{taskName}}',
        body: 'Lembrete de prazo.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTempo restante: 7 dias',
      },
    },
  },
];

const TASK_FORECAST_TEMPLATES: TemplateConfig[] = [
  {
    key: 'task.forecast_today',
    name: 'Previsao de Liberacao Hoje',
    templates: {
      inApp: {
        title: 'Previsao de Liberacao Hoje',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} tem previsao de liberacao para HOJE.',
      },
      push: {
        title: 'Liberacao Hoje',
        body: '{{taskName}} {{serialNumber}} - Previsao para hoje',
      },
      email: {
        subject: 'Previsao de Liberacao Hoje - {{taskName}}',
        body: 'A tarefa tem previsao de liberacao para hoje.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}',
      },
    },
  },
  {
    key: 'task.forecast_1day',
    name: 'Previsao de Liberacao Amanha',
    templates: {
      inApp: {
        title: 'Previsao de Liberacao Amanha',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} tem previsao de liberacao para amanha.',
      },
      push: {
        title: 'Liberacao Amanha',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Previsao de Liberacao Amanha - {{taskName}}',
        body: 'A tarefa tem previsao de liberacao para amanha.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}',
      },
    },
  },
  {
    key: 'task.forecast_3days',
    name: 'Previsao de Liberacao em 3 Dias',
    templates: {
      inApp: {
        title: 'Previsao de Liberacao em 3 Dias',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} tem previsao de liberacao em 3 dias.',
      },
      push: {
        title: 'Liberacao em 3 Dias',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Previsao de Liberacao em 3 Dias - {{taskName}}',
        body: 'A tarefa tem previsao de liberacao em 3 dias.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}',
      },
    },
  },
  {
    key: 'task.forecast_7days',
    name: 'Previsao de Liberacao em 7 Dias',
    templates: {
      inApp: {
        title: 'Previsao de Liberacao em 7 Dias',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} tem previsao de liberacao em 7 dias.',
      },
      push: {
        title: 'Liberacao em 1 Semana',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Previsao de Liberacao em 7 Dias - {{taskName}}',
        body: 'A tarefa tem previsao de liberacao em 7 dias.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}',
      },
    },
  },
  {
    key: 'task.forecast_10days',
    name: 'Previsao de Liberacao em 10 Dias',
    templates: {
      inApp: {
        title: 'Previsao de Liberacao em 10 Dias',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} tem previsao de liberacao em 10 dias.',
      },
      push: {
        title: 'Liberacao em 10 Dias',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Previsao de Liberacao em 10 Dias - {{taskName}}',
        body: 'A tarefa tem previsao de liberacao em 10 dias.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}',
      },
    },
  },
  {
    key: 'task.forecast_overdue',
    name: 'Previsao de Liberacao Atrasada',
    templates: {
      inApp: {
        title: 'Previsao de Liberacao Atrasada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} esta com a previsao de liberacao atrasada em {{daysOverdue}} dia(s).',
      },
      push: {
        title: 'Liberacao Atrasada',
        body: '{{taskName}} {{serialNumber}} - {{daysOverdue}} dia(s) de atraso',
      },
      email: {
        subject: '[ATENCAO] Previsao de Liberacao Atrasada - {{taskName}}',
        body: 'A previsao de liberacao desta tarefa esta atrasada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nDias de atraso: {{daysOverdue}}',
      },
    },
  },
];

const TASK_FIELD_TEMPLATES: TemplateConfig[] = [
  {
    key: 'task.field.status',
    name: 'Status da Tarefa Alterado',
    templates: {
      inApp: {
        title: 'Status da Tarefa Alterado',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve o status alterado de "{{oldValue}}" para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Status Alterado',
        body: '{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}',
      },
      email: {
        subject: 'Status Alterado - {{taskName}}',
        body: 'O status da tarefa foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nStatus anterior: {{oldValue}}\nNovo status: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.forecastDate',
    name: 'Previsao de Liberacao Atualizada',
    templates: {
      inApp: {
        title: 'Previsao de Liberacao Atualizada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a previsao de liberacao alterada de {{oldValue}} para {{newValue}} por {{changedBy}}.',
      },
      push: {
        title: 'Previsao Atualizada',
        body: '{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}',
      },
      email: {
        subject: 'Previsao de Liberacao Atualizada - {{taskName}}',
        body: 'A previsao de liberacao foi atualizada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nData anterior: {{oldValue}}\nNova data: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.term',
    name: 'Prazo da Tarefa Alterado',
    templates: {
      inApp: {
        title: 'Prazo da Tarefa Alterado',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve o prazo alterado de {{oldValue}} para {{newValue}} por {{changedBy}}.',
      },
      push: {
        title: 'Prazo Alterado',
        body: '{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}',
      },
      email: {
        subject: 'Prazo Alterado - {{taskName}}',
        body: 'O prazo da tarefa foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nPrazo anterior: {{oldValue}}\nNovo prazo: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.sectorId',
    name: 'Setor da Tarefa Alterado',
    templates: {
      inApp: {
        title: 'Setor da Tarefa Alterado',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} foi transferida para outro setor por {{changedBy}}.',
      },
      push: {
        title: 'Setor Alterado',
        body: '{{taskName}} {{serialNumber}} - Transferida de setor',
      },
      email: {
        subject: 'Setor Alterado - {{taskName}}',
        body: 'A tarefa foi transferida para outro setor.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.priority',
    name: 'Prioridade da Tarefa Alterada',
    templates: {
      inApp: {
        title: 'Prioridade da Tarefa Alterada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a prioridade alterada de "{{oldValue}}" para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Prioridade Alterada',
        body: '{{taskName}} {{serialNumber}}: {{newValue}}',
      },
      email: {
        subject: 'Prioridade Alterada - {{taskName}}',
        body: 'A prioridade da tarefa foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nPrioridade anterior: {{oldValue}}\nNova prioridade: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.details',
    name: 'Detalhes da Tarefa Atualizados',
    templates: {
      inApp: {
        title: 'Detalhes da Tarefa Atualizados',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve os detalhes atualizados por {{changedBy}}.',
      },
      push: {
        title: 'Detalhes Atualizados',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Detalhes Atualizados - {{taskName}}',
        body: 'Os detalhes da tarefa foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.observation',
    name: 'Observacao da Tarefa Atualizada',
    templates: {
      inApp: {
        title: 'Observacao da Tarefa Atualizada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve uma observacao atualizada por {{changedBy}}.',
      },
      push: {
        title: 'Observacao Atualizada',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Observacao Atualizada - {{taskName}}',
        body: 'Uma observacao da tarefa foi atualizada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.name',
    name: 'Nome da Tarefa Alterado',
    templates: {
      inApp: {
        title: 'Nome da Tarefa Alterado',
        body: 'A tarefa {{serialNumber}} teve o nome alterado de "{{oldValue}}" para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Nome Alterado',
        body: '{{serialNumber}}: {{oldValue}} -> {{newValue}}',
      },
      email: {
        subject: 'Nome da Tarefa Alterado',
        body: 'O nome da tarefa foi alterado.\n\nIdentificador: {{serialNumber}}\nNome anterior: {{oldValue}}\nNovo nome: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.serialNumber',
    name: 'Numero de Serie Alterado',
    templates: {
      inApp: {
        title: 'Numero de Serie Alterado',
        body: 'A tarefa "{{taskName}}" teve o numero de serie alterado de "{{oldValue}}" para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Serie Alterada',
        body: '{{taskName}}: {{oldValue}} -> {{newValue}}',
      },
      email: {
        subject: 'Numero de Serie Alterado - {{taskName}}',
        body: 'O numero de serie foi alterado.\n\nTarefa: {{taskName}}\nNumero anterior: {{oldValue}}\nNovo numero: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.customerId',
    name: 'Cliente da Tarefa Alterado',
    templates: {
      inApp: {
        title: 'Cliente da Tarefa Alterado',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve o cliente alterado por {{changedBy}}.',
      },
      push: {
        title: 'Cliente Alterado',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Cliente Alterado - {{taskName}}',
        body: 'O cliente da tarefa foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.paintId',
    name: 'Tinta da Tarefa Alterada',
    templates: {
      inApp: {
        title: 'Tinta da Tarefa Alterada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a tinta alterada por {{changedBy}}.',
      },
      push: {
        title: 'Tinta Alterada',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Tinta Alterada - {{taskName}}',
        body: 'A tinta da tarefa foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.entryDate',
    name: 'Data de Entrada Alterada',
    templates: {
      inApp: {
        title: 'Data de Entrada Alterada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a data de entrada alterada de {{oldValue}} para {{newValue}} por {{changedBy}}.',
      },
      push: {
        title: 'Data de Entrada',
        body: '{{taskName}} {{serialNumber}}: {{newValue}}',
      },
      email: {
        subject: 'Data de Entrada Alterada - {{taskName}}',
        body: 'A data de entrada foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nData anterior: {{oldValue}}\nNova data: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.startedAt',
    name: 'Data de Inicio Alterada',
    templates: {
      inApp: {
        title: 'Data de Inicio Alterada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a data de inicio alterada de {{oldValue}} para {{newValue}} por {{changedBy}}.',
      },
      push: {
        title: 'Data de Inicio',
        body: '{{taskName}} {{serialNumber}}: {{newValue}}',
      },
      email: {
        subject: 'Data de Inicio Alterada - {{taskName}}',
        body: 'A data de inicio foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nData anterior: {{oldValue}}\nNova data: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.finishedAt',
    name: 'Data de Conclusao Alterada',
    templates: {
      inApp: {
        title: 'Data de Conclusao Alterada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a data de conclusao alterada de {{oldValue}} para {{newValue}} por {{changedBy}}.',
      },
      push: {
        title: 'Data de Conclusao',
        body: '{{taskName}} {{serialNumber}}: {{newValue}}',
      },
      email: {
        subject: 'Data de Conclusao Alterada - {{taskName}}',
        body: 'A data de conclusao foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nData anterior: {{oldValue}}\nNova data: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.commission',
    name: 'Comissao da Tarefa Alterada',
    templates: {
      inApp: {
        title: 'Comissao da Tarefa Alterada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a comissao alterada por {{changedBy}}.',
      },
      push: {
        title: 'Comissao Alterada',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Comissao Alterada - {{taskName}}',
        body: 'A comissao da tarefa foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.representatives',
    name: 'Representantes da Tarefa Alterados',
    templates: {
      inApp: {
        title: 'Representantes da Tarefa Alterados',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve os representantes alterados por {{changedBy}}.',
      },
      push: {
        title: 'Representantes Alterados',
        body: '{{taskName}} {{serialNumber}}',
      },
      email: {
        subject: 'Representantes Alterados - {{taskName}}',
        body: 'Os representantes da tarefa foram alterados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}',
      },
    },
  },
];

const TRUCK_FIELD_TEMPLATES: TemplateConfig[] = [
  {
    key: 'task.field.truck.plate',
    name: 'Placa do Caminhao Alterada',
    templates: {
      inApp: {
        title: 'Placa do Caminhao Alterada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a placa alterada de "{{oldValue}}" para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Placa Alterada',
        body: '{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}',
      },
      email: {
        subject: 'Placa do Caminhao Alterada - {{taskName}}',
        body: 'A placa do caminhao foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nPlaca anterior: {{oldValue}}\nNova placa: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.truck.chassisNumber',
    name: 'Chassi do Caminhao Alterado',
    templates: {
      inApp: {
        title: 'Chassi do Caminhao Alterado',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve o chassi alterado de "{{oldValue}}" para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Chassi Alterado',
        body: '{{taskName}} {{serialNumber}}: {{oldValue}} -> {{newValue}}',
      },
      email: {
        subject: 'Chassi do Caminhao Alterado - {{taskName}}',
        body: 'O chassi do caminhao foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nChassi anterior: {{oldValue}}\nNovo chassi: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.truck.category',
    name: 'Categoria do Caminhao Alterada',
    templates: {
      inApp: {
        title: 'Categoria do Caminhao Alterada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a categoria do caminhao alterada de "{{oldValue}}" para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Categoria Alterada',
        body: '{{taskName}} {{serialNumber}}: {{newValue}}',
      },
      email: {
        subject: 'Categoria do Caminhao Alterada - {{taskName}}',
        body: 'A categoria do caminhao foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nCategoria anterior: {{oldValue}}\nNova categoria: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.truck.implementType',
    name: 'Tipo de Implemento Alterado',
    templates: {
      inApp: {
        title: 'Tipo de Implemento Alterado',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve o tipo de implemento alterado de "{{oldValue}}" para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Implemento Alterado',
        body: '{{taskName}} {{serialNumber}}: {{newValue}}',
      },
      email: {
        subject: 'Tipo de Implemento Alterado - {{taskName}}',
        body: 'O tipo de implemento foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nTipo anterior: {{oldValue}}\nNovo tipo: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.truck.spot',
    name: 'Vaga do Caminhao Alterada',
    templates: {
      inApp: {
        title: 'Vaga do Caminhao Alterada',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve a vaga alterada de "{{oldValue}}" para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Vaga Alterada',
        body: '{{taskName}} {{serialNumber}}: {{newValue}}',
      },
      email: {
        subject: 'Vaga do Caminhao Alterada - {{taskName}}',
        body: 'A vaga do caminhao foi alterada.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nVaga anterior: {{oldValue}}\nNova vaga: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.truck.leftSideLayoutId',
    name: 'Layout Lado Esquerdo Alterado',
    templates: {
      inApp: {
        title: 'Layout Lado Esquerdo Alterado',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve o layout do lado esquerdo alterado por {{changedBy}}.',
      },
      push: {
        title: 'Layout Esquerdo',
        body: '{{taskName}} {{serialNumber}} - Layout atualizado',
      },
      email: {
        subject: 'Layout Lado Esquerdo Alterado - {{taskName}}',
        body: 'O layout do lado esquerdo foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.truck.rightSideLayoutId',
    name: 'Layout Lado Direito Alterado',
    templates: {
      inApp: {
        title: 'Layout Lado Direito Alterado',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve o layout do lado direito alterado por {{changedBy}}.',
      },
      push: {
        title: 'Layout Direito',
        body: '{{taskName}} {{serialNumber}} - Layout atualizado',
      },
      email: {
        subject: 'Layout Lado Direito Alterado - {{taskName}}',
        body: 'O layout do lado direito foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.truck.backSideLayoutId',
    name: 'Layout Traseira Alterado',
    templates: {
      inApp: {
        title: 'Layout Traseira Alterado',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve o layout da traseira alterado por {{changedBy}}.',
      },
      push: {
        title: 'Layout Traseira',
        body: '{{taskName}} {{serialNumber}} - Layout atualizado',
      },
      email: {
        subject: 'Layout Traseira Alterado - {{taskName}}',
        body: 'O layout da traseira foi alterado.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterado por: {{changedBy}}',
      },
    },
  },
];

const FILE_ARRAY_TEMPLATES: TemplateConfig[] = [
  {
    key: 'task.field.artworks',
    name: 'Artes da Tarefa Atualizadas',
    templates: {
      inApp: {
        title: 'Artes da Tarefa Atualizadas',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}.',
      },
      push: {
        title: 'Artes Atualizadas',
        body: '{{taskName}} {{serialNumber}}: {{fileChangeDescription}}',
      },
      email: {
        subject: 'Artes Atualizadas - {{taskName}}',
        body: 'Os arquivos de arte foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.budgets',
    name: 'Orcamentos da Tarefa Atualizados',
    templates: {
      inApp: {
        title: 'Orcamentos da Tarefa Atualizados',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}.',
      },
      push: {
        title: 'Orcamentos Atualizados',
        body: '{{taskName}} {{serialNumber}}: {{fileChangeDescription}}',
      },
      email: {
        subject: 'Orcamentos Atualizados - {{taskName}}',
        body: 'Os arquivos de orcamento foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.invoices',
    name: 'Notas Fiscais da Tarefa Atualizadas',
    templates: {
      inApp: {
        title: 'Notas Fiscais da Tarefa Atualizadas',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}.',
      },
      push: {
        title: 'Notas Fiscais Atualizadas',
        body: '{{taskName}} {{serialNumber}}: {{fileChangeDescription}}',
      },
      email: {
        subject: 'Notas Fiscais Atualizadas - {{taskName}}',
        body: 'Os arquivos de nota fiscal foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.receipts',
    name: 'Recibos da Tarefa Atualizados',
    templates: {
      inApp: {
        title: 'Recibos da Tarefa Atualizados',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}.',
      },
      push: {
        title: 'Recibos Atualizados',
        body: '{{taskName}} {{serialNumber}}: {{fileChangeDescription}}',
      },
      email: {
        subject: 'Recibos Atualizados - {{taskName}}',
        body: 'Os arquivos de recibo foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.bankSlips',
    name: 'Boletos da Tarefa Atualizados',
    templates: {
      inApp: {
        title: 'Boletos da Tarefa Atualizados',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}.',
      },
      push: {
        title: 'Boletos Atualizados',
        body: '{{taskName}} {{serialNumber}}: {{fileChangeDescription}}',
      },
      email: {
        subject: 'Boletos Atualizados - {{taskName}}',
        body: 'Os arquivos de boleto foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.baseFiles',
    name: 'Arquivos Base Atualizados',
    templates: {
      inApp: {
        title: 'Arquivos Base Atualizados',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}.',
      },
      push: {
        title: 'Arquivos Base',
        body: '{{taskName}} {{serialNumber}}: {{fileChangeDescription}}',
      },
      email: {
        subject: 'Arquivos Base Atualizados - {{taskName}}',
        body: 'Os arquivos base foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.logoPaints',
    name: 'Logos/Pinturas Atualizadas',
    templates: {
      inApp: {
        title: 'Logos/Pinturas Atualizadas',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}.',
      },
      push: {
        title: 'Logos/Pinturas',
        body: '{{taskName}} {{serialNumber}}: {{fileChangeDescription}}',
      },
      email: {
        subject: 'Logos/Pinturas Atualizadas - {{taskName}}',
        body: 'Os arquivos de logos e pinturas foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.reimbursements',
    name: 'Reembolsos Atualizados',
    templates: {
      inApp: {
        title: 'Reembolsos Atualizados',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}.',
      },
      push: {
        title: 'Reembolsos',
        body: '{{taskName}} {{serialNumber}}: {{fileChangeDescription}}',
      },
      email: {
        subject: 'Reembolsos Atualizados - {{taskName}}',
        body: 'Os arquivos de reembolso foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'task.field.invoiceReimbursements',
    name: 'Notas de Reembolso Atualizadas',
    templates: {
      inApp: {
        title: 'Notas de Reembolso Atualizadas',
        body: 'A tarefa "{{taskName}}" {{serialNumber}} teve {{fileChangeDescription}} por {{changedBy}}.',
      },
      push: {
        title: 'Notas de Reembolso',
        body: '{{taskName}} {{serialNumber}}: {{fileChangeDescription}}',
      },
      email: {
        subject: 'Notas de Reembolso Atualizadas - {{taskName}}',
        body: 'Os arquivos de nota de reembolso foram atualizados.\n\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nAlterações: {{fileChangeDescription}}\nAtualizado por: {{changedBy}}',
      },
    },
  },
];

// Combine all templates
const ALL_TEMPLATES: TemplateConfig[] = [
  ...TASK_LIFECYCLE_TEMPLATES,
  ...TASK_DEADLINE_TEMPLATES,
  ...TASK_FORECAST_TEMPLATES,
  ...TASK_FIELD_TEMPLATES,
  ...TRUCK_FIELD_TEMPLATES,
  ...FILE_ARRAY_TEMPLATES,
];

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function updateTemplates() {
  console.log('Starting notification template update...\n');

  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const config of ALL_TEMPLATES) {
    try {
      const result = await prisma.notificationConfiguration.updateMany({
        where: { key: config.key },
        data: {
          templates: config.templates as any,
          name: config.name,
          updatedAt: new Date(),
        },
      });

      if (result.count > 0) {
        console.log(`✅ Updated: ${config.key}`);
        updated++;
      } else {
        console.log(`⚠️  Not found: ${config.key}`);
        notFound++;
      }
    } catch (error) {
      console.error(`❌ Error updating ${config.key}:`, error);
      errors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total templates: ${ALL_TEMPLATES.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Not found (need to create): ${notFound}`);
  console.log(`Errors: ${errors}`);
}

updateTemplates()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
