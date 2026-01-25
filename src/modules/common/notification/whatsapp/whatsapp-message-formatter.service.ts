import { Injectable } from '@nestjs/common';

/**
 * WhatsApp Message Format Result
 * Supports both button messages and fallback text-only format
 */
export interface WhatsAppMessageFormat {
  text: string;
  buttons?: Array<{
    buttonId: string;
    buttonText: { displayText: string };
    type: number;
  }>;
  footer?: string;
  /** Fallback text with URL when buttons are not supported */
  fallbackText?: string;
}

/**
 * WhatsApp Message Formatter Service
 *
 * Creates beautiful, professional WhatsApp messages with:
 * - Strategic emoji usage for visual hierarchy
 * - WhatsApp markdown formatting (*bold*, _italic_)
 * - Clean, organized structure
 * - Professional tone
 * - Interactive buttons for actions (with text fallback)
 */
@Injectable()
export class WhatsAppMessageFormatterService {

  // ═══════════════════════════════════════════════════════════════
  // TASK NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════

  formatTaskCreated(data: {
    taskName: string;
    sectorName: string;
    serialNumber?: string;
    customerName?: string;
    dueDate?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  🎯 *NOVA TAREFA CRIADA*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📋 *Tarefa*
${data.taskName}

🏢 *Setor*
${data.sectorName}${data.customerName ? `\n\n👤 *Cliente*\n${data.customerName}` : ''}${data.serialNumber ? `\n\n🔢 *Série*\n${data.serialNumber}` : ''}${data.dueDate ? `\n\n📅 *Prazo*\n${data.dueDate}` : ''}
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'view_task',
          buttonText: { displayText: '📋 Ver Detalhes' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Ver detalhes: ${data.url}`,
    };
  }

  formatTaskStatusChanged(data: {
    taskName: string;
    oldStatus: string;
    newStatus: string;
    changedBy?: string;
    serialNumber?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const statusEmoji = this.getStatusEmoji(data.newStatus);

    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ${statusEmoji} *STATUS ATUALIZADO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📋 *Tarefa*
${data.taskName}${data.serialNumber ? `\n🔢 *Série:* ${data.serialNumber}` : ''}

🔄 *Mudança de Status*
${data.oldStatus} ➜ *${data.newStatus}*${data.changedBy ? `\n\n👤 *Alterado por*\n${data.changedBy}` : ''}
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'view_task',
          buttonText: { displayText: '👁️ Acompanhar' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Acompanhar: ${data.url}`,
    };
  }

  formatTaskDeadlineApproaching(data: {
    taskName: string;
    daysRemaining: number;
    dueDate: string;
    serialNumber?: string;
    priority?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const urgencyLevel = data.daysRemaining <= 1 ? '🚨' : data.daysRemaining <= 3 ? '⚠️' : '⏰';
    const urgencyText = data.daysRemaining <= 1 ? 'URGENTE' : data.daysRemaining <= 3 ? 'ATENÇÃO' : 'AVISO';

    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ${urgencyLevel} *${urgencyText}: PRAZO PRÓXIMO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📋 *Tarefa*
${data.taskName}${data.serialNumber ? `\n🔢 *Série:* ${data.serialNumber}` : ''}

⏰ *Prazo*
${data.dueDate}
_Faltam ${data.daysRemaining} dia${data.daysRemaining !== 1 ? 's' : ''}_${data.priority ? `\n\n🎯 *Prioridade*\n${this.getPriorityEmoji(data.priority)} ${data.priority}` : ''}

${data.daysRemaining <= 1 ? '⚠️ *AÇÃO IMEDIATA NECESSÁRIA!*' : ''}
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'view_task',
          buttonText: { displayText: '⚡ Ver Agora' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Ver tarefa: ${data.url}`,
    };
  }

  formatTaskOverdue(data: {
    taskName: string;
    daysOverdue: number;
    dueDate: string;
    serialNumber?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  🚨 *TAREFA ATRASADA*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

⚠️ *Esta tarefa está atrasada!*

📋 *Tarefa*
${data.taskName}${data.serialNumber ? `\n🔢 *Série:* ${data.serialNumber}` : ''}

📅 *Prazo Original*
${data.dueDate}

🔴 *Atrasada há*
*${data.daysOverdue} dia${data.daysOverdue !== 1 ? 's' : ''}*

⚡ *AÇÃO URGENTE NECESSÁRIA*
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'resolve_task',
          buttonText: { displayText: '🔥 Resolver Agora' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Resolver: ${data.url}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ORDER NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════

  formatOrderCreated(data: {
    orderNumber: string;
    supplierName: string;
    totalValue?: string;
    itemCount?: number;
    expectedDate?: string;
    createdBy?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  📦 *NOVO PEDIDO CRIADO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

🔖 *Pedido*
#${data.orderNumber}

🏪 *Fornecedor*
${data.supplierName}${data.totalValue ? `\n\n💰 *Valor Total*\n${data.totalValue}` : ''}${data.itemCount ? `\n\n📊 *Itens*\n${data.itemCount} item${data.itemCount !== 1 ? 'ns' : ''}` : ''}${data.expectedDate ? `\n\n📅 *Entrega Prevista*\n${data.expectedDate}` : ''}${data.createdBy ? `\n\n👤 *Criado por*\n${data.createdBy}` : ''}
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'view_order',
          buttonText: { displayText: '📋 Ver Pedido' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Ver pedido: ${data.url}`,
    };
  }

  formatOrderOverdue(data: {
    orderNumber: string;
    supplierName: string;
    daysOverdue: number;
    expectedDate: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  🚨 *PEDIDO ATRASADO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

⚠️ *Entrega não recebida no prazo!*

🔖 *Pedido*
#${data.orderNumber}

🏪 *Fornecedor*
${data.supplierName}

📅 *Entrega Esperada*
${data.expectedDate}

🔴 *Atrasado há*
*${data.daysOverdue} dia${data.daysOverdue !== 1 ? 's' : ''}*

📞 *Ação necessária:*
Contatar fornecedor para atualização
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'view_order',
          buttonText: { displayText: '📱 Contatar' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Ver pedido: ${data.url}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STOCK / INVENTORY NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════

  formatStockLow(data: {
    itemName: string;
    currentQuantity: number;
    reorderPoint: number;
    unit?: string;
    categoryName?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ⚠️ *ESTOQUE BAIXO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📦 *Item*
${data.itemName}${data.categoryName ? `\n🏷️ *Categoria:* ${data.categoryName}` : ''}

📊 *Situação Atual*
🟡 ${data.currentQuantity} ${data.unit || 'unidades'}
📌 Ponto de reabastecimento: ${data.reorderPoint}

💡 *Recomendação:*
Considere fazer um novo pedido
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'create_order',
          buttonText: { displayText: '📦 Criar Pedido' },
          type: 1,
        },
        {
          buttonId: 'view_stock',
          buttonText: { displayText: '📊 Ver Estoque' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Gerenciar estoque: ${data.url}`,
    };
  }

  formatStockCritical(data: {
    itemName: string;
    currentQuantity: number;
    unit?: string;
    categoryName?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  🚨 *ESTOQUE CRÍTICO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

⚠️ *Nível crítico atingido!*

📦 *Item*
${data.itemName}${data.categoryName ? `\n🏷️ *Categoria:* ${data.categoryName}` : ''}

📊 *Quantidade Restante*
🔴 *${data.currentQuantity} ${data.unit || 'unidades'}*

⚡ *AÇÃO URGENTE:*
Reabastecimento necessário imediatamente!
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'urgent_order',
          buttonText: { displayText: '🔥 Reabastecer Agora' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Reabastecer: ${data.url}`,
    };
  }

  formatStockOut(data: {
    itemName: string;
    categoryName?: string;
    lastMovement?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  🚨 *ESTOQUE ESGOTADO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

⛔ *SEM ESTOQUE DISPONÍVEL*

📦 *Item*
${data.itemName}${data.categoryName ? `\n🏷️ *Categoria:* ${data.categoryName}` : ''}

📊 *Situação*
🔴 *0 unidades disponíveis*${data.lastMovement ? `\n\n🕐 *Última movimentação*\n${data.lastMovement}` : ''}

⚡ *AÇÃO IMEDIATA NECESSÁRIA!*
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'restock_now',
          buttonText: { displayText: '🚨 Reabastecer' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Reabastecer: ${data.url}`,
    };
  }

  formatItemNeedingOrder(data: {
    items: Array<{
      name: string;
      currentQuantity: number;
      reorderPoint: number;
      suggestedQuantity?: number;
      unit?: string;
    }>;
    totalItems: number;
    url: string;
  }): WhatsAppMessageFormat {
    const itemsList = data.items.slice(0, 5).map((item, index) =>
      `${index + 1}. ${item.name}\n   📊 ${item.currentQuantity} ${item.unit || 'un'}${item.suggestedQuantity ? ` → ${item.suggestedQuantity}` : ''}`
    ).join('\n\n');

    const moreItems = data.totalItems > 5 ? `\n\n_...e mais ${data.totalItems - 5} item${data.totalItems - 5 !== 1 ? 'ns' : ''}_` : '';

    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  📋 *ITENS PRECISAM REABASTECIMENTO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

⚠️ *${data.totalItems} item${data.totalItems !== 1 ? 'ns' : ''} abaixo do ponto de reabastecimento*

📦 *Itens Prioritários:*

${itemsList}${moreItems}

💡 *Ação Recomendada:*
Criar pedido de compra para estes itens
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'create_bulk_order',
          buttonText: { displayText: '📦 Criar Pedido' },
          type: 1,
        },
        {
          buttonId: 'view_list',
          buttonText: { displayText: '📋 Ver Lista' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Criar pedido: ${data.url}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SERVICE ORDER NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════

  formatServiceOrderCreated(data: {
    serviceOrderDescription: string;
    taskName: string;
    serviceOrderType: string;
    assignedTo?: string;
    dueDate?: string;
    creatorName?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  🛠️ *NOVA ORDEM DE SERVIÇO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📝 *Descrição*
${data.serviceOrderDescription}

📋 *Tarefa Vinculada*
${data.taskName}

🏷️ *Tipo*
${data.serviceOrderType}${data.assignedTo ? `\n\n👤 *Responsável*\n${data.assignedTo}` : ''}${data.dueDate ? `\n\n📅 *Prazo*\n${data.dueDate}` : ''}${data.creatorName ? `\n\n✏️ *Criado por*\n${data.creatorName}` : ''}
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'start_work',
          buttonText: { displayText: '▶️ Iniciar Trabalho' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Iniciar: ${data.url}`,
    };
  }

  formatServiceOrderStatusChanged(data: {
    serviceOrderDescription: string;
    taskName: string;
    oldStatus: string;
    newStatus: string;
    changedByName?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const statusEmoji = this.getStatusEmoji(data.newStatus);

    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ${statusEmoji} *O.S. ATUALIZADA*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📝 *Ordem de Serviço*
${data.serviceOrderDescription}

📋 *Tarefa*
${data.taskName}

🔄 *Status*
${data.oldStatus} ➜ *${data.newStatus}*${data.changedByName ? `\n\n👤 *Alterado por*\n${data.changedByName}` : ''}
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'view_os',
          buttonText: { displayText: '👁️ Ver Detalhes' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Ver: ${data.url}`,
    };
  }

  formatArtworkWaitingApproval(data: {
    serviceOrderDescription: string;
    taskName: string;
    artistName?: string;
    filesCount?: number;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  🎨 *ARTE AGUARDANDO APROVAÇÃO*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📝 *Ordem de Serviço*
${data.serviceOrderDescription}

📋 *Tarefa*
${data.taskName}${data.artistName ? `\n\n🎨 *Artista*\n${data.artistName}` : ''}${data.filesCount ? `\n\n📁 *Arquivos*\n${data.filesCount} arquivo${data.filesCount !== 1 ? 's' : ''}` : ''}

✅ *Ação necessária:*
Revisar e aprovar a arte
    `.trim();

    return {
      text,
      buttons: [
        {
          buttonId: 'approve_art',
          buttonText: { displayText: '✅ Aprovar' },
          type: 1,
        },
        {
          buttonId: 'view_art',
          buttonText: { displayText: '👁️ Visualizar' },
          type: 1,
        },
      ],
      footer: 'Sistema Ankaa',
      fallbackText: `${text}\n\n🔗 Visualizar: ${data.url}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════

  private getStatusEmoji(status: string): string {
    const statusMap: Record<string, string> = {
      // Task statuses
      'PENDENTE': '⏸️',
      'EM_ANDAMENTO': '🔵',
      'PAUSADO': '⏸️',
      'CONCLUIDO': '✅',
      'CANCELADO': '❌',

      // Order statuses
      'RASCUNHO': '📝',
      'AGUARDANDO': '⏳',
      'ENVIADO': '📤',
      'RECEBIDO': '✅',
      'PARCIALMENTE_RECEBIDO': '🟡',

      // Service Order statuses
      'NAO_INICIADO': '⏸️',
      'EXECUTANDO': '🔵',
      'AGUARDANDO_APROVACAO': '⏰',
      'APROVADO': '✅',
      'REPROVADO': '❌',
    };

    return statusMap[status] || '🔔';
  }

  private getPriorityEmoji(priority: string): string {
    const priorityMap: Record<string, string> = {
      'URGENTE': '🔴',
      'ALTA': '🟠',
      'MEDIA': '🟡',
      'BAIXA': '🟢',
      'CRITICA': '🚨',
    };

    return priorityMap[priority.toUpperCase()] || '📌';
  }

  /**
   * Format generic notification with consistent structure
   */
  formatGenericNotification(data: {
    title: string;
    body: string;
    url?: string;
    metadata?: Record<string, any>;
  }): WhatsAppMessageFormat {
    const parts = [
      `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`,
      `  🔔 *${data.title.toUpperCase()}*`,
      `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`,
      '',
      data.body,
    ];

    if (data.metadata) {
      Object.entries(data.metadata).forEach(([key, value]) => {
        if (value) {
          parts.push('', `${this.getMetadataLabel(key)}: ${value}`);
        }
      });
    }

    const text = parts.join('\n').trim();

    return {
      text,
      buttons: data.url ? [
        {
          buttonId: 'view_details',
          buttonText: { displayText: '👁️ Ver Mais' },
          type: 1,
        },
      ] : undefined,
      footer: 'Sistema Ankaa',
      fallbackText: data.url ? `${text}\n\n🔗 Ver mais: ${data.url}` : text,
    };
  }

  private getMetadataLabel(key: string): string {
    const labels: Record<string, string> = {
      dueDate: '📅 *Prazo*',
      priority: '🎯 *Prioridade*',
      sector: '🏢 *Setor*',
      customer: '👤 *Cliente*',
      assignedTo: '👤 *Responsável*',
      value: '💰 *Valor*',
      quantity: '📊 *Quantidade*',
    };

    return labels[key] || `*${key}*`;
  }
}
