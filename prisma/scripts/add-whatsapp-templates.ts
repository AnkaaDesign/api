/**
 * =============================================================================
 * ADD WHATSAPP TEMPLATES TO ALL NOTIFICATION CONFIGURATIONS
 * =============================================================================
 *
 * WhatsApp templates only have a body field (no title).
 * This script adds whatsapp templates to all existing configurations.
 *
 * Run with: npx tsx prisma/scripts/add-whatsapp-templates.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface WhatsAppTemplate {
  key: string;
  whatsapp: {
    body: string;
  };
}

// =============================================================================
// TASK LIFECYCLE TEMPLATES
// =============================================================================

const taskLifecycleWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'task.created',
    whatsapp: {
      body: '📋 *Nova Tarefa Criada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Cliente: {{customerName}}\nCriado por: {{createdBy}}',
    },
  },
  {
    key: 'task.waiting_production',
    whatsapp: {
      body: '⏳ *Tarefa Aguardando Producao*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  },
  {
    key: 'task.in_production',
    whatsapp: {
      body: '🔧 *Tarefa em Producao*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Iniciado por: {{startedBy}}',
    },
  },
  {
    key: 'task.completed',
    whatsapp: {
      body: '✅ *Tarefa Concluida*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Concluido por: {{completedBy}}',
    },
  },
  {
    key: 'task.ready_for_production',
    whatsapp: {
      body: '🚀 *Tarefa Pronta para Producao*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  },
];

// =============================================================================
// TASK DEADLINE TEMPLATES
// =============================================================================

const taskDeadlineWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'task.overdue',
    whatsapp: {
      body: '🚨 *TAREFA ATRASADA*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Prazo: {{deadline}}\nAcao urgente necessaria!',
    },
  },
  {
    key: 'task.deadline_1hour',
    whatsapp: {
      body: '⚠️ *Prazo em 1 HORA*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Prazo: {{deadline}}',
    },
  },
  {
    key: 'task.deadline_4hours',
    whatsapp: {
      body: '⚠️ *Prazo em 4 horas*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Prazo: {{deadline}}',
    },
  },
  {
    key: 'task.deadline_1day',
    whatsapp: {
      body: '📅 *Prazo em 1 dia*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Prazo: {{deadline}}',
    },
  },
  {
    key: 'task.deadline_3days',
    whatsapp: {
      body: '📅 *Prazo em 3 dias*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Prazo: {{deadline}}',
    },
  },
  {
    key: 'task.deadline_7days',
    whatsapp: {
      body: '📅 *Prazo em 7 dias*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Prazo: {{deadline}}',
    },
  },
];

// =============================================================================
// TASK FORECAST TEMPLATES
// =============================================================================

const taskForecastWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'task.forecast_today',
    whatsapp: {
      body: '📆 *Previsao para HOJE*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  },
  {
    key: 'task.forecast_1day',
    whatsapp: {
      body: '📆 *Previsao para amanha*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  },
  {
    key: 'task.forecast_3days',
    whatsapp: {
      body: '📆 *Previsao em 3 dias*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  },
  {
    key: 'task.forecast_7days',
    whatsapp: {
      body: '📆 *Previsao em 7 dias*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  },
  {
    key: 'task.forecast_10days',
    whatsapp: {
      body: '📆 *Previsao em 10 dias*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  },
  {
    key: 'task.forecast_overdue',
    whatsapp: {
      body: '🚨 *PREVISAO ATRASADA*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Previsao: {{forecastDate}}\nAcao urgente necessaria!',
    },
  },
];

// =============================================================================
// TASK FIELD UPDATE TEMPLATES
// =============================================================================

const taskFieldWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'task.field.status',
    whatsapp: {
      body: '🔄 *Status Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNovo: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.forecastDate',
    whatsapp: {
      body: '📅 *Previsao de Liberacao Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.term',
    whatsapp: {
      body: '📅 *Prazo Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNovo: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.sectorId',
    whatsapp: {
      body: '🏢 *Setor Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNovo: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.priority',
    whatsapp: {
      body: '⚡ *Prioridade Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.details',
    whatsapp: {
      body: '📝 *Detalhes Atualizados*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}',
    },
  },
  {
    key: 'task.field.observation',
    whatsapp: {
      body: '📝 *Observacao Atualizada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}',
    },
  },
  {
    key: 'task.field.name',
    whatsapp: {
      body: '✏️ *Nome Alterado*\n\nAnterior: {{oldValue}}\nNovo: {{newValue}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}',
    },
  },
  {
    key: 'task.field.serialNumber',
    whatsapp: {
      body: '🔢 *Numero de Serie Alterado*\n\nTarefa: {{taskName}}\nAnterior: {{oldValue}}\nNovo: {{newValue}}\n{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}',
    },
  },
  {
    key: 'task.field.customerId',
    whatsapp: {
      body: '👤 *Cliente Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNovo: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.paintId',
    whatsapp: {
      body: '🎨 *Tinta Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.entryDate',
    whatsapp: {
      body: '📅 *Data de Entrada Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.startedAt',
    whatsapp: {
      body: '▶️ *Data de Inicio Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.finishedAt',
    whatsapp: {
      body: '⏹️ *Data de Conclusao Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.commission',
    whatsapp: {
      body: '💰 *Comissao Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.representatives',
    whatsapp: {
      body: '👥 *Representantes Alterados*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}',
    },
  },
  {
    key: 'task.field.invoiceToId',
    whatsapp: {
      body: '💳 *Faturamento Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNovo: {{newValue}}\nPor: {{changedBy}}',
    },
  },
];

// =============================================================================
// TRUCK FIELD TEMPLATES
// =============================================================================

const truckFieldWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'task.field.truck.plate',
    whatsapp: {
      body: '🚛 *Placa Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.truck.chassisNumber',
    whatsapp: {
      body: '🔧 *Chassi Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNovo: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.truck.category',
    whatsapp: {
      body: '🏷️ *Categoria Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.truck.implementType',
    whatsapp: {
      body: '🚚 *Tipo de Implemento Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNovo: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.truck.spot',
    whatsapp: {
      body: '📍 *Vaga Alterada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Anterior: {{oldValue}}\nNova: {{newValue}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.truck.leftSideLayoutId',
    whatsapp: {
      body: '🖼️ *Layout Lado Esquerdo Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}',
    },
  },
  {
    key: 'task.field.truck.rightSideLayoutId',
    whatsapp: {
      body: '🖼️ *Layout Lado Direito Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}',
    },
  },
  {
    key: 'task.field.truck.backSideLayoutId',
    whatsapp: {
      body: '🖼️ *Layout Traseira Alterado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}',
    },
  },
];

// =============================================================================
// FILE ARRAY FIELD TEMPLATES
// =============================================================================

const fileFieldWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'task.field.artworks',
    whatsapp: {
      body: '🎨 *Artes Atualizadas*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} arquivo(s)\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.budgets',
    whatsapp: {
      body: '💰 *Orcamentos Atualizados*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} arquivo(s)\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.invoices',
    whatsapp: {
      body: '📄 *Notas Fiscais Atualizadas*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} arquivo(s)\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.receipts',
    whatsapp: {
      body: '🧾 *Recibos Atualizados*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} arquivo(s)\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.baseFiles',
    whatsapp: {
      body: '📁 *Arquivos Base Atualizados*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} arquivo(s)\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.logoPaints',
    whatsapp: {
      body: '🎨 *Pinturas de Logo Atualizadas*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} arquivo(s)\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.reimbursements',
    whatsapp: {
      body: '💵 *Reembolsos Atualizados*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} arquivo(s)\nPor: {{changedBy}}',
    },
  },
  {
    key: 'task.field.invoiceReimbursements',
    whatsapp: {
      body: '💵 *Reembolsos de NF Atualizados*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} arquivo(s)\nPor: {{changedBy}}',
    },
  },
];

// =============================================================================
// SERVICE ORDER TEMPLATES
// =============================================================================

const SERVICE_ORDER_TYPES = ['production', 'artwork', 'commercial', 'financial', 'logistic'] as const;

const SERVICE_ORDER_TYPE_NAMES: Record<string, string> = {
  production: 'Producao',
  artwork: 'Arte',
  commercial: 'Comercial',
  financial: 'Financeira',
  logistic: 'Logistica',
};

const SERVICE_ORDER_EMOJIS: Record<string, string> = {
  production: '🏭',
  artwork: '🎨',
  commercial: '💼',
  financial: '💰',
  logistic: '🚚',
};

function generateServiceOrderWhatsApp(): WhatsAppTemplate[] {
  const templates: WhatsAppTemplate[] = [];

  for (const type of SERVICE_ORDER_TYPES) {
    const typeName = SERVICE_ORDER_TYPE_NAMES[type];
    const emoji = SERVICE_ORDER_EMOJIS[type];

    templates.push({
      key: `service_order.created.${type}`,
      whatsapp: {
        body: `${emoji} *Nova Ordem de Servico ${typeName}*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Criado por: {{createdBy}}`,
      },
    });

    templates.push({
      key: `service_order.assigned.${type}`,
      whatsapp: {
        body: `${emoji} *Ordem de Servico ${typeName} Atribuida*\n\nVoce foi atribuido!\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{assignedBy}}`,
      },
    });

    templates.push({
      key: `service_order.started.${type}`,
      whatsapp: {
        body: `${emoji} *Ordem de Servico ${typeName} Iniciada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{startedBy}}`,
      },
    });

    templates.push({
      key: `service_order.completed.${type}`,
      whatsapp: {
        body: `${emoji} ✅ *Ordem de Servico ${typeName} Concluida*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{completedBy}}`,
      },
    });

    templates.push({
      key: `service_order.cancelled.${type}`,
      whatsapp: {
        body: `${emoji} ❌ *Ordem de Servico ${typeName} Cancelada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{cancelledBy}}`,
      },
    });

    templates.push({
      key: `service_order.observation_changed.${type}`,
      whatsapp: {
        body: `${emoji} 📝 *Observacao Ordem de Servico ${typeName}*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}\n\n{{observation}}`,
      },
    });

    templates.push({
      key: `service_order.status_changed_for_creator.${type}`,
      whatsapp: {
        body: `${emoji} 🔄 *Status Ordem de Servico ${typeName}: {{newStatus}}*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{changedBy}}`,
      },
    });
  }

  templates.push({
    key: 'service_order.waiting_approval.artwork',
    whatsapp: {
      body: '🎨 ⏳ *Ordem de Servico Arte Aguardando Aprovacao*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  });

  return templates;
}

// =============================================================================
// CUT (RECORTE) TEMPLATES
// =============================================================================

const cutWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'cut.created',
    whatsapp: {
      body: '✂️ *Novo Recorte*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Criado por: {{createdBy}}',
    },
  },
  {
    key: 'cut.started',
    whatsapp: {
      body: '✂️ *Recorte Iniciado*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{startedBy}}',
    },
  },
  {
    key: 'cut.completed',
    whatsapp: {
      body: '✂️ ✅ *Recorte Concluido*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{completedBy}}',
    },
  },
  {
    key: 'cut.request.created',
    whatsapp: {
      body: '✂️ 📋 *Solicitacao de Recorte*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Solicitado por: {{requestedBy}}',
    },
  },
  {
    key: 'cuts.added.to.task',
    whatsapp: {
      body: '✂️ *Recortes Adicionados*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} recorte(s)\nPor: {{addedBy}}',
    },
  },
];

// =============================================================================
// ARTWORK TEMPLATES
// =============================================================================

const artworkWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'artwork.approved',
    whatsapp: {
      body: '🎨 ✅ *Arte Aprovada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{approvedBy}}',
    },
  },
  {
    key: 'artwork.reproved',
    whatsapp: {
      body: '🎨 ❌ *Arte Reprovada*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Por: {{reprovedBy}}\n\nMotivo: {{reason}}',
    },
  },
  {
    key: 'artwork.pending_approval_reminder',
    whatsapp: {
      body: '🎨 ⏳ *Arte Pendente de Aprovacao*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  },
];

// =============================================================================
// BORROW TEMPLATES
// =============================================================================

const borrowWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'borrow.unreturned_reminder',
    whatsapp: {
      body: '📦 *Lembrete de Devolucao*\n\nItem: {{itemName}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Emprestado em: {{borrowedAt}}',
    },
  },
  {
    key: 'borrow.unreturned_manager_reminder',
    whatsapp: {
      body: '📦 ⚠️ *Item Nao Devolvido*\n\nItem: {{itemName}}\nEmprestado por: {{borrowedBy}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
    },
  },
];

// =============================================================================
// ITEM/STOCK TEMPLATES
// =============================================================================

const itemWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'item.low_stock',
    whatsapp: {
      body: '📦 ⚠️ *Estoque Baixo*\n\nItem: {{itemName}}\n{{#if brand}}Marca: {{brand}}\n{{/if}}{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}Quantidade: {{quantity}} un.\nMinimo: {{minQuantity}} un.',
    },
  },
  {
    key: 'item.out_of_stock',
    whatsapp: {
      body: '📦 🚨 *ITEM ESGOTADO*\n\nItem: {{itemName}}\n{{#if brand}}Marca: {{brand}}\n{{/if}}{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}\nAcao urgente necessaria!',
    },
  },
  {
    key: 'item.overstock',
    whatsapp: {
      body: '📦 *Excesso de Estoque*\n\nItem: {{itemName}}\nQuantidade: {{quantity}} un.\nMaximo: {{maxQuantity}} un.',
    },
  },
  {
    key: 'item.reorder_required',
    whatsapp: {
      body: '📦 🔄 *Recompra Necessaria*\n\nItem: {{itemName}}\n{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}Quantidade atual: {{quantity}} un.',
    },
  },
];

// =============================================================================
// ORDER TEMPLATES
// =============================================================================

const orderWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'order.created',
    whatsapp: {
      body: '📋 *Novo Pedido #{{orderNumber}}*\n\n{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}Itens: {{itemCount}}\nCriado por: {{createdBy}}',
    },
  },
  {
    key: 'order.cancelled',
    whatsapp: {
      body: '📋 ❌ *Pedido Cancelado #{{orderNumber}}*\n\nPor: {{cancelledBy}}\n{{#if reason}}Motivo: {{reason}}{{/if}}',
    },
  },
  {
    key: 'order.status.changed',
    whatsapp: {
      body: '📋 🔄 *Pedido #{{orderNumber}}: {{newStatus}}*\n\nAnterior: {{oldStatus}}\nPor: {{changedBy}}',
    },
  },
  {
    key: 'order.overdue',
    whatsapp: {
      body: '📋 🚨 *Pedido Atrasado #{{orderNumber}}*\n\n{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}Previsao: {{expectedDate}}',
    },
  },
  {
    key: 'order.item.received',
    whatsapp: {
      body: '📦 ✅ *Item Recebido*\n\nPedido: #{{orderNumber}}\nItem: {{itemName}}\nQuantidade: {{quantity}} un.',
    },
  },
  {
    key: 'order.item.entered_inventory',
    whatsapp: {
      body: '📦 ➕ *Entrada no Estoque*\n\nItem: {{itemName}}\nQuantidade: +{{quantity}} un.\nNovo saldo: {{newBalance}} un.',
    },
  },
];

// =============================================================================
// PAINT TEMPLATES
// =============================================================================

const paintWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'paint.produced',
    whatsapp: {
      body: '🎨 *Tinta Produzida*\n\nTinta: {{paintName}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{quantity}}',
    },
  },
];

// =============================================================================
// PPE (EPI) TEMPLATES
// =============================================================================

const ppeWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'ppe.requested',
    whatsapp: {
      body: '🦺 *Solicitacao de EPI*\n\nItem: {{itemName}}\nQuantidade: {{quantity}}\nSolicitado por: {{requestedBy}}\n{{#if reason}}Motivo: {{reason}}{{/if}}',
    },
  },
  {
    key: 'ppe.approved',
    whatsapp: {
      body: '🦺 ✅ *EPI Aprovado*\n\nItem: {{itemName}}\nQuantidade: {{quantity}}\nAprovado por: {{approvedBy}}',
    },
  },
  {
    key: 'ppe.rejected',
    whatsapp: {
      body: '🦺 ❌ *EPI Reprovado*\n\nItem: {{itemName}}\nReprovado por: {{rejectedBy}}\n{{#if reason}}Motivo: {{reason}}{{/if}}',
    },
  },
  {
    key: 'ppe.delivered',
    whatsapp: {
      body: '🦺 📦 *EPI Entregue*\n\nItem: {{itemName}}\nQuantidade: {{quantity}}\nEntregue por: {{deliveredBy}}',
    },
  },
];

// =============================================================================
// TIME ENTRY TEMPLATES
// =============================================================================

const timeEntryWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'timeentry.reminder',
    whatsapp: {
      body: '⏰ *Registre seu Ponto*\n\nVoce ainda nao registrou seu ponto {{#if isEntry}}de entrada{{else}}de saida{{/if}} hoje.\n{{#if lastEntry}}Ultimo registro: {{lastEntry}}{{/if}}',
    },
  },
];

// =============================================================================
// TASK PRICING TEMPLATES
// =============================================================================

const taskPricingWhatsApp: WhatsAppTemplate[] = [
  {
    key: 'task_pricing.payment_due',
    whatsapp: {
      body: '💰 *Pagamento Pendente*\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Nº Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Valor: {{amount}}\nVencimento: {{dueDate}}',
    },
  },
];

// =============================================================================
// MAIN FUNCTION
// =============================================================================

async function main() {
  console.log('Adding WhatsApp templates to all notification configurations...\n');

  const allTemplates: WhatsAppTemplate[] = [
    ...taskLifecycleWhatsApp,
    ...taskDeadlineWhatsApp,
    ...taskForecastWhatsApp,
    ...taskFieldWhatsApp,
    ...truckFieldWhatsApp,
    ...fileFieldWhatsApp,
    ...generateServiceOrderWhatsApp(),
    ...cutWhatsApp,
    ...artworkWhatsApp,
    ...borrowWhatsApp,
    ...itemWhatsApp,
    ...orderWhatsApp,
    ...paintWhatsApp,
    ...ppeWhatsApp,
    ...timeEntryWhatsApp,
    ...taskPricingWhatsApp,
  ];

  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const template of allTemplates) {
    try {
      const existing = await prisma.notificationConfiguration.findUnique({
        where: { key: template.key },
      });

      if (!existing) {
        console.log(`⚠️  Not found: ${template.key}`);
        notFound++;
        continue;
      }

      // Merge WhatsApp template into existing templates
      const existingTemplates = (existing.templates as Record<string, any>) || {};
      const updatedTemplates = {
        ...existingTemplates,
        whatsapp: template.whatsapp,
      };

      await prisma.notificationConfiguration.update({
        where: { key: template.key },
        data: {
          templates: updatedTemplates,
        },
      });

      console.log(`✅ Added WhatsApp: ${template.key}`);
      updated++;
    } catch (error) {
      console.error(`❌ Error updating ${template.key}:`, error);
      errors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total templates: ${allTemplates.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Not found: ${notFound}`);
  console.log(`Errors: ${errors}`);
}

main()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
