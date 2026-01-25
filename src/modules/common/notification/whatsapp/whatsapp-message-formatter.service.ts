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
 * - Simple dividers that work across all devices
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
    const lines: string[] = [];

    lines.push('🎯 *NOVA TAREFA CRIADA*');
    lines.push('');
    lines.push(`📋 *Tarefa:* ${data.taskName}`);
    lines.push(`🏢 *Setor:* ${data.sectorName}`);

    if (data.customerName) {
      lines.push(`👤 *Cliente:* ${data.customerName}`);
    }

    if (data.serialNumber) {
      lines.push(`🔢 *Serie:* ${data.serialNumber}`);
    }

    if (data.dueDate) {
      lines.push(`📅 *Prazo:* ${data.dueDate}`);
    }

    if (data.url) {
      lines.push('');
      lines.push('🔗 *Ver detalhes:*');
      lines.push(data.url);
    }

    const text = lines.join('\n');

    return {
      text,
      fallbackText: text,
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

    const text = `${statusEmoji} *STATUS ATUALIZADO*

📋 *Tarefa:* ${data.taskName}${data.serialNumber ? `\n🔢 *Série:* ${data.serialNumber}` : ''}

🔄 *Status:* ${data.oldStatus} → *${data.newStatus}*${data.changedBy ? `\n👤 *Por:* ${data.changedBy}` : ''}

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
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
    const urgencyEmoji = data.daysRemaining <= 1 ? '🚨' : data.daysRemaining <= 3 ? '⚠️' : '⏰';

    const text = `${urgencyEmoji} *PRAZO SE APROXIMANDO*

📋 *Tarefa:* ${data.taskName}${data.serialNumber ? `\n🔢 *Série:* ${data.serialNumber}` : ''}

⏰ *Prazo:* ${data.dueDate}
_Faltam ${data.daysRemaining} dia${data.daysRemaining !== 1 ? 's' : ''}_${data.priority ? `\n🎯 *Prioridade:* ${this.getPriorityEmoji(data.priority)} ${data.priority}` : ''}

${data.daysRemaining <= 1 ? '⚠️ *AÇÃO IMEDIATA NECESSÁRIA!*\n\n' : ''}🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
    };
  }

  formatTaskOverdue(data: {
    taskName: string;
    daysOverdue: number;
    dueDate: string;
    serialNumber?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `🚨 *TAREFA ATRASADA*

⚠️ _Esta tarefa está atrasada!_

📋 *Tarefa:* ${data.taskName}${data.serialNumber ? `\n🔢 *Série:* ${data.serialNumber}` : ''}

📅 *Prazo:* ${data.dueDate}

🔴 *Atrasada há ${data.daysOverdue} dia${data.daysOverdue !== 1 ? 's' : ''}*

⚡ *AÇÃO URGENTE NECESSÁRIA*

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
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
    const text = `📦 *NOVO PEDIDO CRIADO*

🔖 *Pedido:* #${data.orderNumber}

🏪 *Fornecedor:* ${data.supplierName}${data.totalValue ? `\n💰 *Valor:* ${data.totalValue}` : ''}${data.itemCount ? `\n📊 *Itens:* ${data.itemCount}` : ''}${data.expectedDate ? `\n📅 *Entrega:* ${data.expectedDate}` : ''}${data.createdBy ? `\n👤 *Por:* ${data.createdBy}` : ''}

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
    };
  }

  formatOrderOverdue(data: {
    orderNumber: string;
    supplierName: string;
    daysOverdue: number;
    expectedDate: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `🚨 *PEDIDO ATRASADO*

⚠️ _Entrega não recebida no prazo!_

🔖 *Pedido:* #${data.orderNumber}

🏪 *Fornecedor:* ${data.supplierName}

📅 *Entrega esperada:* ${data.expectedDate}

🔴 *Atrasado há ${data.daysOverdue} dia${data.daysOverdue !== 1 ? 's' : ''}*

📞 Contatar fornecedor para atualização

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
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
    const text = `⚠️ *ESTOQUE BAIXO*

📦 *Item:* ${data.itemName}${data.categoryName ? `\n🏷️ *Categoria:* ${data.categoryName}` : ''}

📊 *Situação:*
🟡 ${data.currentQuantity} ${data.unit || 'un'}
📌 Ponto de reabastecimento: ${data.reorderPoint}

💡 _Recomenda-se fazer um novo pedido_

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
    };
  }

  formatStockCritical(data: {
    itemName: string;
    currentQuantity: number;
    unit?: string;
    categoryName?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `🚨 *ESTOQUE CRÍTICO*

⚠️ _Nível crítico atingido!_

📦 *Item:* ${data.itemName}${data.categoryName ? `\n🏷️ *Categoria:* ${data.categoryName}` : ''}

📊 *Restante:*
🔴 *${data.currentQuantity} ${data.unit || 'un'}*

⚡ *REABASTECIMENTO URGENTE!*

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
    };
  }

  formatStockOut(data: {
    itemName: string;
    categoryName?: string;
    lastMovement?: string;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `🚨 *ESTOQUE ESGOTADO*

⛔ *SEM ESTOQUE DISPONÍVEL*

📦 *Item:* ${data.itemName}${data.categoryName ? `\n🏷️ *Categoria:* ${data.categoryName}` : ''}${data.lastMovement ? `\n🕐 *Última movimentação:* ${data.lastMovement}` : ''}

📊 *Quantidade:* 🔴 *0 unidades*

⚡ *AÇÃO IMEDIATA NECESSÁRIA!*

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
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
      `${index + 1}. *${item.name}*\n   📊 ${item.currentQuantity} ${item.unit || 'un'}${item.suggestedQuantity ? ` → ${item.suggestedQuantity}` : ''}`
    ).join('\n\n');

    const moreItems = data.totalItems > 5 ? `\n\n_...e mais ${data.totalItems - 5} item${data.totalItems - 5 !== 1 ? 'ns' : ''}_` : '';

    const text = `📋 *ITENS PRECISAM REABASTECIMENTO*

⚠️ *${data.totalItems} item${data.totalItems !== 1 ? 'ns' : ''} abaixo do ponto de reabastecimento*

${itemsList}${moreItems}

💡 _Criar pedido de compra para estes itens_

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
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
    const text = `🛠️ *NOVA ORDEM DE SERVIÇO*

📝 *Descrição:* ${data.serviceOrderDescription}

📋 *Tarefa:* ${data.taskName}

🏷️ *Tipo:* ${data.serviceOrderType}${data.assignedTo ? `\n👤 *Responsável:* ${data.assignedTo}` : ''}${data.dueDate ? `\n📅 *Prazo:* ${data.dueDate}` : ''}${data.creatorName ? `\n✏️ *Criado por:* ${data.creatorName}` : ''}

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
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

    const text = `${statusEmoji} *O.S. ATUALIZADA*

📝 *Ordem:* ${data.serviceOrderDescription}

📋 *Tarefa:* ${data.taskName}

🔄 *Status:* ${data.oldStatus} → *${data.newStatus}*${data.changedByName ? `\n👤 *Por:* ${data.changedByName}` : ''}

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
    };
  }

  formatArtworkWaitingApproval(data: {
    serviceOrderDescription: string;
    taskName: string;
    artistName?: string;
    filesCount?: number;
    url: string;
  }): WhatsAppMessageFormat {
    const text = `🎨 *ARTE AGUARDANDO APROVAÇÃO*

📝 *Ordem:* ${data.serviceOrderDescription}

📋 *Tarefa:* ${data.taskName}${data.artistName ? `\n🎨 *Artista:* ${data.artistName}` : ''}${data.filesCount ? `\n📁 *Arquivos:* ${data.filesCount}` : ''}

✅ _Revisar e aprovar a arte_

🔗 *Ver detalhes:*
${data.url}`;

    return {
      text,
      fallbackText: text,
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
   * Get urgency icon based on importance level
   */
  private getUrgencyIcon(importance?: string): string {
    const importanceMap: Record<string, string> = {
      'URGENT': '🚨',
      'HIGH': '🔴',
      'MEDIUM': '🔔',
      'LOW': 'ℹ️',
    };

    return importanceMap[importance?.toUpperCase() || 'MEDIUM'] || '🔔';
  }

  /**
   * Format generic notification with consistent structure
   */
  formatGenericNotification(data: {
    title: string;
    body: string;
    url?: string;
    metadata?: Record<string, any>;
    importance?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  }): WhatsAppMessageFormat {
    // Build message line by line - simple and clean
    const lines: string[] = [];

    // Get urgency icon based on importance
    const urgencyIcon = this.getUrgencyIcon(data.importance);

    // Add title with urgency icon
    if (data.title) {
      lines.push(`${urgencyIcon} *${data.title.toUpperCase()}*`);
      lines.push('');
    }

    // Add body
    if (data.body) {
      lines.push(data.body);
    }

    // Add metadata fields (excluding title, body, and url)
    if (data.metadata) {
      const metadataLines: string[] = [];
      Object.entries(data.metadata).forEach(([key, value]) => {
        // Skip title, body, and url as they're handled separately
        if (key === 'title' || key === 'body' || key === 'url') {
          return;
        }

        // Only add non-empty values
        if (value !== null && value !== undefined && value !== '') {
          const label = this.getMetadataLabel(key);
          metadataLines.push(`${label}: ${value}`);
        }
      });

      if (metadataLines.length > 0) {
        lines.push('');
        lines.push(...metadataLines);
      }
    }

    // Add URL at the end with action icon
    if (data.url) {
      lines.push('');
      lines.push('🔗 *Ver mais:*');
      lines.push(data.url);
    }

    const text = lines.join('\n');

    return {
      text,
      fallbackText: text,
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
