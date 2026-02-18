/**
 * =============================================================================
 * NOTIFICATION TEMPLATES UPDATE SCRIPT - PART 2
 * =============================================================================
 *
 * This script updates additional NotificationConfiguration records:
 * - Service Orders (all types: production, artwork, commercial, financial, logistic)
 * - Cuts (recortes)
 * - Artwork (artes)
 * - Borrows (empréstimos)
 * - Items/Stock (estoque)
 * - Orders (pedidos)
 * - Paint (tintas)
 * - PPE (EPIs)
 * - Time Entry (registro de ponto)
 * - Task Pricing (cobrança)
 *
 * Run with: npx tsx prisma/scripts/update-notification-templates-part2.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface NotificationTemplate {
  key: string;
  name: string;
  templates: {
    inApp: {
      title: string;
      body: string;
    };
    push: {
      title: string;
      body: string;
    };
    email?: {
      subject: string;
      body: string;
    };
  };
}

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

function generateServiceOrderTemplates(): NotificationTemplate[] {
  const templates: NotificationTemplate[] = [];

  for (const type of SERVICE_ORDER_TYPES) {
    const typeName = SERVICE_ORDER_TYPE_NAMES[type];

    // Created
    templates.push({
      key: `service_order.created.${type}`,
      name: `Ordem de Servico ${typeName} Criada`,
      templates: {
        inApp: {
          title: `Nova Ordem de Servico ${typeName}`,
          body: `Uma nova ordem de servico de ${typeName.toLowerCase()} foi criada para a tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}}. Criado por {{createdBy}}.`,
        },
        push: {
          title: `Nova Ordem de Servico ${typeName}`,
          body: `{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} - Nova ordem criada`,
        },
        email: {
          subject: `Nova Ordem de Servico ${typeName} - {{taskName}}`,
          body: `Uma nova ordem de servico de ${typeName.toLowerCase()} foi criada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Criado por: {{createdBy}}\nData: {{createdAt}}`,
        },
      },
    });

    // Assigned
    templates.push({
      key: `service_order.assigned.${type}`,
      name: `Ordem de Servico ${typeName} Atribuida`,
      templates: {
        inApp: {
          title: `Ordem de Servico ${typeName} Atribuida`,
          body: `Voce foi atribuido a uma ordem de servico de ${typeName.toLowerCase()} para a tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}}. Atribuido por {{assignedBy}}.`,
        },
        push: {
          title: `Ordem de Servico ${typeName} Atribuida`,
          body: `{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} - Voce foi atribuido`,
        },
        email: {
          subject: `Ordem de Servico ${typeName} Atribuida - {{taskName}}`,
          body: `Voce foi atribuido a uma ordem de servico de ${typeName.toLowerCase()}.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Atribuido por: {{assignedBy}}`,
        },
      },
    });

    // Started
    templates.push({
      key: `service_order.started.${type}`,
      name: `Ordem de Servico ${typeName} Iniciada`,
      templates: {
        inApp: {
          title: `Ordem de Servico ${typeName} Iniciada`,
          body: `A ordem de servico de ${typeName.toLowerCase()} da tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} foi iniciada por {{startedBy}}.`,
        },
        push: {
          title: `Ordem de Servico ${typeName} Iniciada`,
          body: `{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} - Ordem iniciada`,
        },
        email: {
          subject: `Ordem de Servico ${typeName} Iniciada - {{taskName}}`,
          body: `A ordem de servico de ${typeName.toLowerCase()} foi iniciada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Iniciada por: {{startedBy}}\nInicio: {{startedAt}}`,
        },
      },
    });

    // Completed
    templates.push({
      key: `service_order.completed.${type}`,
      name: `Ordem de Servico ${typeName} Concluida`,
      templates: {
        inApp: {
          title: `Ordem de Servico ${typeName} Concluida`,
          body: `A ordem de servico de ${typeName.toLowerCase()} da tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} foi concluida por {{completedBy}}.`,
        },
        push: {
          title: `Ordem de Servico ${typeName} Concluida`,
          body: `{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} - Ordem concluida`,
        },
        email: {
          subject: `Ordem de Servico ${typeName} Concluida - {{taskName}}`,
          body: `A ordem de servico de ${typeName.toLowerCase()} foi concluida.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Concluida por: {{completedBy}}\nConclusao: {{completedAt}}`,
        },
      },
    });

    // Cancelled
    templates.push({
      key: `service_order.cancelled.${type}`,
      name: `Ordem de Servico ${typeName} Cancelada`,
      templates: {
        inApp: {
          title: `Ordem de Servico ${typeName} Cancelada`,
          body: `A ordem de servico de ${typeName.toLowerCase()} da tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} foi cancelada por {{cancelledBy}}.`,
        },
        push: {
          title: `Ordem de Servico ${typeName} Cancelada`,
          body: `{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} - Ordem cancelada`,
        },
        email: {
          subject: `Ordem de Servico ${typeName} Cancelada - {{taskName}}`,
          body: `A ordem de servico de ${typeName.toLowerCase()} foi cancelada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Cancelada por: {{cancelledBy}}`,
        },
      },
    });

    // Observation Changed
    templates.push({
      key: `service_order.observation_changed.${type}`,
      name: `Observacao de Ordem de Servico ${typeName} Alterada`,
      templates: {
        inApp: {
          title: `Observacao da Ordem de Servico ${typeName} Alterada`,
          body: `A observacao da ordem de servico de ${typeName.toLowerCase()} da tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} foi alterada por {{changedBy}}.`,
        },
        push: {
          title: `Ordem de Servico ${typeName}: Observacao`,
          body: `{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} - Observacao alterada`,
        },
        email: {
          subject: `Observacao da Ordem de Servico ${typeName} Alterada - {{taskName}}`,
          body: `A observacao da ordem de servico de ${typeName.toLowerCase()} foi alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Alterada por: {{changedBy}}\n\nNova observacao:\n{{observation}}`,
        },
      },
    });

    // Status Changed (for creator)
    templates.push({
      key: `service_order.status_changed_for_creator.${type}`,
      name: `Status da Ordem de Servico ${typeName} Alterado (Criador)`,
      templates: {
        inApp: {
          title: `Status da Ordem de Servico ${typeName} Alterado`,
          body: `O status da ordem de servico de ${typeName.toLowerCase()} da tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} foi alterado para "{{newStatus}}" por {{changedBy}}.`,
        },
        push: {
          title: `Ordem de Servico ${typeName}: {{newStatus}}`,
          body: `{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} - Status alterado`,
        },
        email: {
          subject: `Status da Ordem de Servico ${typeName} Alterado - {{taskName}}`,
          body: `O status da ordem de servico de ${typeName.toLowerCase()} foi alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Status anterior: {{oldStatus}}\nNovo status: {{newStatus}}\nAlterado por: {{changedBy}}`,
        },
      },
    });
  }

  // Waiting Approval (only for artwork)
  templates.push({
    key: 'service_order.waiting_approval.artwork',
    name: 'Ordem de Servico Arte Aguardando Aprovacao',
    templates: {
      inApp: {
        title: 'Ordem de Servico Arte Aguardando Aprovacao',
        body: 'A ordem de servico de arte da tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} esta aguardando aprovacao.',
      },
      push: {
        title: 'Ordem de Servico Arte: Aguardando Aprovacao',
        body: '{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if plate}} ({{plate}}){{/if}} - Aprovacao necessaria',
      },
      email: {
        subject: 'Ordem de Servico Arte Aguardando Aprovacao - {{taskName}}',
        body: 'A ordem de servico de arte esta aguardando sua aprovacao.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
      },
    },
  });

  return templates;
}

// =============================================================================
// CUT (RECORTE) TEMPLATES
// =============================================================================

const cutTemplates: NotificationTemplate[] = [
  {
    key: 'cut.created',
    name: 'Recorte Criado',
    templates: {
      inApp: {
        title: 'Novo Recorte Criado',
        body: 'Um novo recorte foi criado para a tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}}. Criado por {{createdBy}}.',
      },
      push: {
        title: 'Novo Recorte',
        body: '{{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} - Recorte criado',
      },
      email: {
        subject: 'Novo Recorte Criado - {{taskName}}',
        body: 'Um novo recorte foi criado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Criado por: {{createdBy}}',
      },
    },
  },
  {
    key: 'cut.started',
    name: 'Recorte Iniciado',
    templates: {
      inApp: {
        title: 'Recorte Iniciado',
        body: 'O recorte da tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} foi iniciado por {{startedBy}}.',
      },
      push: {
        title: 'Recorte Iniciado',
        body: '{{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} - Em andamento',
      },
      email: {
        subject: 'Recorte Iniciado - {{taskName}}',
        body: 'O recorte foi iniciado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Iniciado por: {{startedBy}}',
      },
    },
  },
  {
    key: 'cut.completed',
    name: 'Recorte Concluido',
    templates: {
      inApp: {
        title: 'Recorte Concluido',
        body: 'O recorte da tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} foi concluido por {{completedBy}}.',
      },
      push: {
        title: 'Recorte Concluido',
        body: '{{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} - Concluido',
      },
      email: {
        subject: 'Recorte Concluido - {{taskName}}',
        body: 'O recorte foi concluido.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Concluido por: {{completedBy}}',
      },
    },
  },
  {
    key: 'cut.request.created',
    name: 'Solicitacao de Recorte',
    templates: {
      inApp: {
        title: 'Nova Solicitacao de Recorte',
        body: 'Uma nova solicitacao de recorte foi criada para a tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}}. Solicitado por {{requestedBy}}.',
      },
      push: {
        title: 'Solicitacao de Recorte',
        body: '{{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} - Nova solicitacao',
      },
      email: {
        subject: 'Nova Solicitacao de Recorte - {{taskName}}',
        body: 'Uma nova solicitacao de recorte foi criada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Solicitado por: {{requestedBy}}',
      },
    },
  },
  {
    key: 'cuts.added.to.task',
    name: 'Recortes Adicionados',
    templates: {
      inApp: {
        title: 'Recortes Adicionados a Tarefa',
        body: '{{count}} recorte(s) foram adicionados a tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} por {{addedBy}}.',
      },
      push: {
        title: 'Recortes Adicionados',
        body: '{{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} - {{count}} recorte(s)',
      },
      email: {
        subject: 'Recortes Adicionados - {{taskName}}',
        body: 'Recortes foram adicionados a tarefa.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{count}} recorte(s)\nAdicionado por: {{addedBy}}',
      },
    },
  },
];

// =============================================================================
// ARTWORK TEMPLATES
// =============================================================================

const artworkTemplates: NotificationTemplate[] = [
  {
    key: 'artwork.approved',
    name: 'Arte Aprovada',
    templates: {
      inApp: {
        title: 'Arte Aprovada',
        body: 'A arte da tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} foi aprovada por {{approvedBy}}.',
      },
      push: {
        title: 'Arte Aprovada',
        body: '{{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} - Arte aprovada',
      },
      email: {
        subject: 'Arte Aprovada - {{taskName}}',
        body: 'A arte foi aprovada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Aprovada por: {{approvedBy}}',
      },
    },
  },
  {
    key: 'artwork.reproved',
    name: 'Arte Reprovada',
    templates: {
      inApp: {
        title: 'Arte Reprovada',
        body: 'A arte da tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} foi reprovada por {{reprovedBy}}. Motivo: {{reason}}',
      },
      push: {
        title: 'Arte Reprovada',
        body: '{{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} - Arte reprovada',
      },
      email: {
        subject: 'Arte Reprovada - {{taskName}}',
        body: 'A arte foi reprovada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Reprovada por: {{reprovedBy}}\nMotivo: {{reason}}',
      },
    },
  },
  {
    key: 'artwork.pending_approval_reminder',
    name: 'Lembrete de Arte Pendente',
    templates: {
      inApp: {
        title: 'Arte Pendente de Aprovacao',
        body: 'A arte da tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} ainda esta aguardando aprovacao.',
      },
      push: {
        title: 'Arte Pendente',
        body: '{{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} - Aprovacao pendente',
      },
      email: {
        subject: 'Lembrete: Arte Aguardando Aprovacao - {{taskName}}',
        body: 'A arte ainda esta aguardando aprovacao.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}',
      },
    },
  },
];

// =============================================================================
// BORROW TEMPLATES
// =============================================================================

const borrowTemplates: NotificationTemplate[] = [
  {
    key: 'borrow.unreturned_reminder',
    name: 'Lembrete de Devolucao',
    templates: {
      inApp: {
        title: 'Lembrete de Devolucao',
        body: 'O item "{{itemName}}" emprestado para a tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} ainda nao foi devolvido. Emprestado em {{borrowedAt}}.',
      },
      push: {
        title: 'Devolucao Pendente',
        body: '{{itemName}} - {{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}}',
      },
      email: {
        subject: 'Lembrete de Devolucao - {{itemName}}',
        body: 'O item emprestado ainda nao foi devolvido.\n\nItem: {{itemName}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Emprestado em: {{borrowedAt}}',
      },
    },
  },
  {
    key: 'borrow.unreturned_manager_reminder',
    name: 'Lembrete de Devolucao (Gestor)',
    templates: {
      inApp: {
        title: 'Itens Nao Devolvidos',
        body: 'O item "{{itemName}}" emprestado por {{borrowedBy}} para a tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} ainda nao foi devolvido.',
      },
      push: {
        title: 'Item Nao Devolvido',
        body: '{{itemName}} - {{borrowedBy}} - {{taskName}}',
      },
      email: {
        subject: 'Gestor: Item Nao Devolvido - {{itemName}}',
        body: 'O item emprestado ainda nao foi devolvido.\n\nItem: {{itemName}}\nEmprestado por: {{borrowedBy}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Emprestado em: {{borrowedAt}}',
      },
    },
  },
];

// =============================================================================
// ITEM/STOCK TEMPLATES
// =============================================================================

const itemTemplates: NotificationTemplate[] = [
  {
    key: 'item.low_stock',
    name: 'Item com Estoque Baixo',
    templates: {
      inApp: {
        title: 'Estoque Baixo',
        body: 'O item "{{itemName}}" esta com estoque baixo. Quantidade atual: {{quantity}} unidades. Minimo recomendado: {{minQuantity}} unidades.',
      },
      push: {
        title: 'Estoque Baixo',
        body: '{{itemName}} - {{quantity}} unidades restantes',
      },
      email: {
        subject: 'Estoque Baixo - {{itemName}}',
        body: 'O item esta com estoque baixo.\n\nItem: {{itemName}}\n{{#if brand}}Marca: {{brand}}\n{{/if}}{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}Quantidade atual: {{quantity}} unidades\nMinimo recomendado: {{minQuantity}} unidades',
      },
    },
  },
  {
    key: 'item.out_of_stock',
    name: 'Item Sem Estoque',
    templates: {
      inApp: {
        title: 'Item Esgotado',
        body: 'O item "{{itemName}}" esta ESGOTADO. {{#if brand}}Marca: {{brand}}. {{/if}}{{#if supplier}}Fornecedor: {{supplier}}.{{/if}} Acao urgente necessaria.',
      },
      push: {
        title: 'ESGOTADO',
        body: '{{itemName}} - Estoque zerado!',
      },
      email: {
        subject: 'URGENTE: Item Esgotado - {{itemName}}',
        body: 'O item esta completamente esgotado.\n\nItem: {{itemName}}\n{{#if brand}}Marca: {{brand}}\n{{/if}}{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}Estoque atual: 0 unidades\n\nAcao urgente necessaria para repor o item.',
      },
    },
  },
  {
    key: 'item.overstock',
    name: 'Excesso de Estoque',
    templates: {
      inApp: {
        title: 'Excesso de Estoque',
        body: 'O item "{{itemName}}" esta com excesso de estoque. Quantidade atual: {{quantity}} unidades. Maximo recomendado: {{maxQuantity}} unidades.',
      },
      push: {
        title: 'Excesso de Estoque',
        body: '{{itemName}} - {{quantity}} unidades (excesso)',
      },
      email: {
        subject: 'Excesso de Estoque - {{itemName}}',
        body: 'O item esta com excesso de estoque.\n\nItem: {{itemName}}\n{{#if brand}}Marca: {{brand}}\n{{/if}}Quantidade atual: {{quantity}} unidades\nMaximo recomendado: {{maxQuantity}} unidades',
      },
    },
  },
  {
    key: 'item.reorder_required',
    name: 'Recompra Necessaria',
    templates: {
      inApp: {
        title: 'Recompra Necessaria',
        body: 'O item "{{itemName}}" atingiu o ponto de recompra. Quantidade atual: {{quantity}} unidades. {{#if supplier}}Fornecedor sugerido: {{supplier}}.{{/if}}',
      },
      push: {
        title: 'Recompra Necessaria',
        body: '{{itemName}} - Pedir reposicao',
      },
      email: {
        subject: 'Recompra Necessaria - {{itemName}}',
        body: 'O item atingiu o ponto de recompra.\n\nItem: {{itemName}}\n{{#if brand}}Marca: {{brand}}\n{{/if}}{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}Quantidade atual: {{quantity}} unidades\nQuantidade sugerida para pedido: {{suggestedQuantity}} unidades',
      },
    },
  },
];

// =============================================================================
// ORDER TEMPLATES
// =============================================================================

const orderTemplates: NotificationTemplate[] = [
  {
    key: 'order.created',
    name: 'Pedido Criado',
    templates: {
      inApp: {
        title: 'Novo Pedido Criado',
        body: 'Um novo pedido #{{orderNumber}} foi criado por {{createdBy}}. {{#if supplier}}Fornecedor: {{supplier}}.{{/if}} Total de {{itemCount}} item(ns).',
      },
      push: {
        title: 'Novo Pedido',
        body: 'Pedido #{{orderNumber}} - {{itemCount}} item(ns)',
      },
      email: {
        subject: 'Novo Pedido Criado - #{{orderNumber}}',
        body: 'Um novo pedido foi criado.\n\nPedido: #{{orderNumber}}\nCriado por: {{createdBy}}\n{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}Total de itens: {{itemCount}}',
      },
    },
  },
  {
    key: 'order.cancelled',
    name: 'Pedido Cancelado',
    templates: {
      inApp: {
        title: 'Pedido Cancelado',
        body: 'O pedido #{{orderNumber}} foi cancelado por {{cancelledBy}}. {{#if reason}}Motivo: {{reason}}{{/if}}',
      },
      push: {
        title: 'Pedido Cancelado',
        body: 'Pedido #{{orderNumber}} foi cancelado',
      },
      email: {
        subject: 'Pedido Cancelado - #{{orderNumber}}',
        body: 'O pedido foi cancelado.\n\nPedido: #{{orderNumber}}\nCancelado por: {{cancelledBy}}\n{{#if reason}}Motivo: {{reason}}\n{{/if}}',
      },
    },
  },
  {
    key: 'order.status.changed',
    name: 'Status do Pedido Alterado',
    templates: {
      inApp: {
        title: 'Status do Pedido Alterado',
        body: 'O status do pedido #{{orderNumber}} foi alterado de "{{oldStatus}}" para "{{newStatus}}" por {{changedBy}}.',
      },
      push: {
        title: 'Pedido: {{newStatus}}',
        body: 'Pedido #{{orderNumber}} - Status alterado',
      },
      email: {
        subject: 'Status do Pedido Alterado - #{{orderNumber}}',
        body: 'O status do pedido foi alterado.\n\nPedido: #{{orderNumber}}\nStatus anterior: {{oldStatus}}\nNovo status: {{newStatus}}\nAlterado por: {{changedBy}}',
      },
    },
  },
  {
    key: 'order.overdue',
    name: 'Pedido Atrasado/Vencendo',
    templates: {
      inApp: {
        title: 'Pedido Atrasado',
        body: 'O pedido #{{orderNumber}} esta {{#if isOverdue}}atrasado{{else}}proximo do vencimento{{/if}}. Previsao de entrega: {{expectedDate}}.',
      },
      push: {
        title: 'Pedido Atrasado',
        body: 'Pedido #{{orderNumber}} - Verificar status',
      },
      email: {
        subject: '{{#if isOverdue}}ATRASADO{{else}}Vencendo{{/if}}: Pedido #{{orderNumber}}',
        body: 'O pedido {{#if isOverdue}}esta atrasado{{else}}esta proximo do vencimento{{/if}}.\n\nPedido: #{{orderNumber}}\n{{#if supplier}}Fornecedor: {{supplier}}\n{{/if}}Previsao de entrega: {{expectedDate}}',
      },
    },
  },
  {
    key: 'order.item.received',
    name: 'Item do Pedido Recebido',
    templates: {
      inApp: {
        title: 'Item Recebido',
        body: 'O item "{{itemName}}" do pedido #{{orderNumber}} foi recebido. Quantidade: {{quantity}} unidades.',
      },
      push: {
        title: 'Item Recebido',
        body: '{{itemName}} - Pedido #{{orderNumber}}',
      },
      email: {
        subject: 'Item Recebido - {{itemName}}',
        body: 'O item do pedido foi recebido.\n\nPedido: #{{orderNumber}}\nItem: {{itemName}}\nQuantidade recebida: {{quantity}} unidades\nRecebido por: {{receivedBy}}',
      },
    },
  },
  {
    key: 'order.item.entered_inventory',
    name: 'Item do Pedido Entrou no Estoque',
    templates: {
      inApp: {
        title: 'Item Adicionado ao Estoque',
        body: 'O item "{{itemName}}" do pedido #{{orderNumber}} foi adicionado ao estoque. Quantidade: {{quantity}} unidades.',
      },
      push: {
        title: 'Estoque Atualizado',
        body: '{{itemName}} +{{quantity}} unidades',
      },
      email: {
        subject: 'Item Entrou no Estoque - {{itemName}}',
        body: 'O item do pedido foi adicionado ao estoque.\n\nPedido: #{{orderNumber}}\nItem: {{itemName}}\nQuantidade adicionada: {{quantity}} unidades\nNovo saldo: {{newBalance}} unidades',
      },
    },
  },
];

// =============================================================================
// PAINT TEMPLATES
// =============================================================================

const paintTemplates: NotificationTemplate[] = [
  {
    key: 'paint.produced',
    name: 'Tinta Produzida',
    templates: {
      inApp: {
        title: 'Tinta Produzida',
        body: 'A tinta "{{paintName}}" foi produzida para a tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}}. Quantidade: {{quantity}}.',
      },
      push: {
        title: 'Tinta Produzida',
        body: '{{paintName}} - {{taskName}}',
      },
      email: {
        subject: 'Tinta Produzida - {{paintName}}',
        body: 'A tinta foi produzida.\n\nTinta: {{paintName}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Quantidade: {{quantity}}',
      },
    },
  },
];

// =============================================================================
// PPE (EPI) TEMPLATES
// =============================================================================

const ppeTemplates: NotificationTemplate[] = [
  {
    key: 'ppe.requested',
    name: 'Nova Solicitacao de EPI',
    templates: {
      inApp: {
        title: 'Nova Solicitacao de EPI',
        body: '{{requestedBy}} solicitou o EPI "{{itemName}}". Quantidade: {{quantity}}. {{#if reason}}Motivo: {{reason}}{{/if}}',
      },
      push: {
        title: 'Solicitacao de EPI',
        body: '{{requestedBy}} - {{itemName}}',
      },
      email: {
        subject: 'Nova Solicitacao de EPI - {{itemName}}',
        body: 'Uma nova solicitacao de EPI foi criada.\n\nSolicitado por: {{requestedBy}}\nItem: {{itemName}}\nQuantidade: {{quantity}}\n{{#if reason}}Motivo: {{reason}}\n{{/if}}',
      },
    },
  },
  {
    key: 'ppe.approved',
    name: 'Solicitacao de EPI Aprovada',
    templates: {
      inApp: {
        title: 'EPI Aprovado',
        body: 'Sua solicitacao do EPI "{{itemName}}" foi aprovada por {{approvedBy}}. Aguarde a entrega.',
      },
      push: {
        title: 'EPI Aprovado',
        body: '{{itemName}} - Solicitacao aprovada',
      },
      email: {
        subject: 'Solicitacao de EPI Aprovada - {{itemName}}',
        body: 'Sua solicitacao de EPI foi aprovada.\n\nItem: {{itemName}}\nQuantidade: {{quantity}}\nAprovado por: {{approvedBy}}\nData: {{approvedAt}}',
      },
    },
  },
  {
    key: 'ppe.rejected',
    name: 'Solicitacao de EPI Reprovada',
    templates: {
      inApp: {
        title: 'EPI Reprovado',
        body: 'Sua solicitacao do EPI "{{itemName}}" foi reprovada por {{rejectedBy}}. {{#if reason}}Motivo: {{reason}}{{/if}}',
      },
      push: {
        title: 'EPI Reprovado',
        body: '{{itemName}} - Solicitacao reprovada',
      },
      email: {
        subject: 'Solicitacao de EPI Reprovada - {{itemName}}',
        body: 'Sua solicitacao de EPI foi reprovada.\n\nItem: {{itemName}}\nReprovado por: {{rejectedBy}}\n{{#if reason}}Motivo: {{reason}}\n{{/if}}',
      },
    },
  },
  {
    key: 'ppe.delivered',
    name: 'EPI Entregue',
    templates: {
      inApp: {
        title: 'EPI Entregue',
        body: 'O EPI "{{itemName}}" foi entregue. Entregue por {{deliveredBy}}.',
      },
      push: {
        title: 'EPI Entregue',
        body: '{{itemName}} - Retirar no local',
      },
      email: {
        subject: 'EPI Entregue - {{itemName}}',
        body: 'O EPI foi entregue.\n\nItem: {{itemName}}\nQuantidade: {{quantity}}\nEntregue por: {{deliveredBy}}\nData: {{deliveredAt}}',
      },
    },
  },
];

// =============================================================================
// TIME ENTRY TEMPLATES
// =============================================================================

const timeEntryTemplates: NotificationTemplate[] = [
  {
    key: 'timeentry.reminder',
    name: 'Lembrete de Registro de Ponto',
    templates: {
      inApp: {
        title: 'Registre seu Ponto',
        body: 'Voce ainda nao registrou seu ponto {{#if isEntry}}de entrada{{else}}de saida{{/if}} hoje. {{#if lastEntry}}Ultimo registro: {{lastEntry}}.{{/if}}',
      },
      push: {
        title: 'Registro de Ponto',
        body: 'Nao esqueca de registrar seu ponto {{#if isEntry}}de entrada{{else}}de saida{{/if}}',
      },
      email: {
        subject: 'Lembrete: Registro de Ponto',
        body: 'Voce ainda nao registrou seu ponto {{#if isEntry}}de entrada{{else}}de saida{{/if}} hoje.\n\n{{#if lastEntry}}Ultimo registro: {{lastEntry}}\n{{/if}}',
      },
    },
  },
];

// =============================================================================
// TASK PRICING TEMPLATES
// =============================================================================

const taskPricingTemplates: NotificationTemplate[] = [
  {
    key: 'task_pricing.payment_due',
    name: 'Lembrete de Cobranca',
    templates: {
      inApp: {
        title: 'Pagamento Pendente',
        body: 'A tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} possui pagamento pendente de {{amount}}. Vencimento: {{dueDate}}.',
      },
      push: {
        title: 'Pagamento Pendente',
        body: '{{taskName}} - {{amount}} vencendo',
      },
      email: {
        subject: 'Pagamento Pendente - {{taskName}}',
        body: 'A tarefa possui pagamento pendente.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}Valor: {{amount}}\nVencimento: {{dueDate}}',
      },
    },
  },
];

// =============================================================================
// TASK FIELD - INVOICE TO ID
// =============================================================================

const additionalTaskFieldTemplates: NotificationTemplate[] = [
  {
    key: 'task.field.invoiceToId',
    name: 'Faturar Para',
    templates: {
      inApp: {
        title: 'Faturamento Alterado',
        body: 'O cliente de faturamento da tarefa "{{taskName}}" {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}} foi alterado{{#if oldValue}} de "{{oldValue}}"{{/if}} para "{{newValue}}" por {{changedBy}}.',
      },
      push: {
        title: 'Faturamento Alterado',
        body: '{{taskName}} {{#if serialNumber}}#{{serialNumber}}{{/if}}{{#if plate}}({{plate}}){{/if}}',
      },
      email: {
        subject: 'Faturamento Alterado - {{taskName}}',
        body: 'O cliente de faturamento foi alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}{{#if plate}}Placa: {{plate}}\n{{/if}}{{#if oldValue}}Anterior: {{oldValue}}\n{{/if}}Novo: {{newValue}}\nAlterado por: {{changedBy}}',
      },
    },
  },
];

// =============================================================================
// MAIN FUNCTION
// =============================================================================

async function main() {
  console.log('Starting notification template update (Part 2)...\n');

  const allTemplates: NotificationTemplate[] = [
    ...generateServiceOrderTemplates(),
    ...cutTemplates,
    ...artworkTemplates,
    ...borrowTemplates,
    ...itemTemplates,
    ...orderTemplates,
    ...paintTemplates,
    ...ppeTemplates,
    ...timeEntryTemplates,
    ...taskPricingTemplates,
    ...additionalTaskFieldTemplates,
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

      await prisma.notificationConfiguration.update({
        where: { key: template.key },
        data: {
          name: template.name,
          templates: template.templates,
        },
      });

      console.log(`✅ Updated: ${template.key}`);
      updated++;
    } catch (error) {
      console.error(`❌ Error updating ${template.key}:`, error);
      errors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total templates: ${allTemplates.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Not found (need to create): ${notFound}`);
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
