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

/** Notification importance levels (mirrors the Prisma `Importance` enum). */
type Importance = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/**
 * WhatsApp Message Formatter Service
 *
 * Emoji policy (2026-06-08): a message carries EXACTLY ONE emoji — the leading
 * importance marker on the title line. No emojis anywhere in the body.
 *   NORMAL / LOW → 🔔   HIGH → ⚠️   URGENT → 🚨
 * The emoji is driven solely by the notification's importance, never by event
 * type or status. Structure/hierarchy is carried by WhatsApp markdown
 * (*bold*, _italic_) and plain text labels.
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
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const lines: string[] = [];

    lines.push(this.titleLine(data.importance, 'NOVA TAREFA CRIADA'));
    lines.push('');
    lines.push(`*Tarefa:* ${data.taskName}`);
    lines.push(`*Setor:* ${data.sectorName}`);

    if (data.customerName) {
      lines.push(`*Cliente:* ${data.customerName}`);
    }

    if (data.serialNumber) {
      lines.push(`*Série:* ${data.serialNumber}`);
    }

    if (data.dueDate) {
      lines.push(`*Prazo:* ${data.dueDate}`);
    }

    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  formatTaskStatusChanged(data: {
    taskName: string;
    oldStatus?: string;
    newStatus?: string;
    // The task notification path supplies oldValue/newValue instead of
    // oldStatus/newStatus, so accept both field-contract shapes.
    oldValue?: string;
    newValue?: string;
    changedBy?: string;
    serialNumber?: string;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const oldStatus = data.oldStatus ?? data.oldValue ?? '';
    const newStatus = data.newStatus ?? data.newValue ?? '';

    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'STATUS ATUALIZADO'));
    lines.push('');
    lines.push(`*Tarefa:* ${data.taskName}`);
    if (data.serialNumber) {
      lines.push(`*Série:* ${data.serialNumber}`);
    }
    lines.push('');
    lines.push(`*Status:* ${oldStatus} → *${newStatus}*`);
    // Actor names are never rendered in notification text (changedBy stays in
    // metadata for routing/audit only).
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  formatTaskDeadlineApproaching(data: {
    taskName: string;
    daysRemaining: number | string;
    dueDate?: string;
    serialNumber?: string;
    priority?: string;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const daysNum =
      typeof data.daysRemaining === 'number'
        ? data.daysRemaining
        : parseInt(String(data.daysRemaining), 10) || 0;

    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'PRAZO SE APROXIMANDO'));
    lines.push('');
    lines.push(`*Tarefa:* ${data.taskName}`);
    if (data.serialNumber) {
      lines.push(`*Série:* ${data.serialNumber}`);
    }
    lines.push('');
    if (data.dueDate) {
      lines.push(`*Prazo:* ${data.dueDate}`);
    }
    lines.push(`_Faltam ${daysNum} dia${daysNum !== 1 ? 's' : ''}_`);
    if (data.priority) {
      lines.push(`*Prioridade:* ${data.priority}`);
    }
    if (daysNum <= 1) {
      lines.push('');
      lines.push('*AÇÃO IMEDIATA NECESSÁRIA!*');
    }
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  formatTaskOverdue(data: {
    taskName: string;
    daysOverdue: number | string;
    dueDate?: string;
    serialNumber?: string;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const daysNum =
      typeof data.daysOverdue === 'number'
        ? data.daysOverdue
        : parseInt(String(data.daysOverdue), 10) || 0;

    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'TAREFA ATRASADA'));
    lines.push('');
    lines.push('_Esta tarefa está atrasada!_');
    lines.push('');
    lines.push(`*Tarefa:* ${data.taskName}`);
    if (data.serialNumber) {
      lines.push(`*Série:* ${data.serialNumber}`);
    }
    lines.push('');
    if (data.dueDate) {
      lines.push(`*Prazo:* ${data.dueDate}`);
    }
    lines.push(`*Atrasada há ${daysNum} dia${daysNum !== 1 ? 's' : ''}*`);
    lines.push('');
    lines.push('*AÇÃO URGENTE NECESSÁRIA*');
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
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
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'NOVO PEDIDO CRIADO'));
    lines.push('');
    lines.push(`*Pedido:* #${data.orderNumber}`);
    lines.push('');
    lines.push(`*Fornecedor:* ${data.supplierName}`);
    if (data.totalValue) {
      lines.push(`*Valor:* ${data.totalValue}`);
    }
    if (data.itemCount) {
      lines.push(`*Itens:* ${data.itemCount}`);
    }
    if (data.expectedDate) {
      lines.push(`*Entrega:* ${data.expectedDate}`);
    }
    // Actor names are never rendered in notification text (createdBy is kept in
    // the payload for compatibility but intentionally not displayed).
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  formatOrderOverdue(data: {
    orderNumber: string;
    supplierName: string;
    daysOverdue: number | string;
    expectedDate: string;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const daysNum =
      typeof data.daysOverdue === 'number'
        ? data.daysOverdue
        : parseInt(String(data.daysOverdue), 10) || 0;

    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'PEDIDO ATRASADO'));
    lines.push('');
    lines.push('_Entrega não recebida no prazo!_');
    lines.push('');
    lines.push(`*Pedido:* #${data.orderNumber}`);
    lines.push('');
    lines.push(`*Fornecedor:* ${data.supplierName}`);
    lines.push('');
    lines.push(`*Entrega esperada:* ${data.expectedDate}`);
    lines.push('');
    lines.push(`*Atrasado há ${daysNum} dia${daysNum !== 1 ? 's' : ''}*`);
    lines.push('');
    lines.push('Contatar fornecedor para atualização');
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
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
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'ESTOQUE BAIXO'));
    lines.push('');
    lines.push(`*Item:* ${data.itemName}`);
    if (data.categoryName) {
      lines.push(`*Categoria:* ${data.categoryName}`);
    }
    lines.push('');
    lines.push('*Situação:*');
    lines.push(`${data.currentQuantity} ${data.unit || 'un'}`);
    lines.push(`Ponto de reabastecimento: ${data.reorderPoint}`);
    lines.push('');
    lines.push('_Recomenda-se fazer um novo pedido_');
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  formatStockCritical(data: {
    itemName: string;
    currentQuantity: number;
    unit?: string;
    categoryName?: string;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'ESTOQUE CRÍTICO'));
    lines.push('');
    lines.push('_Nível crítico atingido!_');
    lines.push('');
    lines.push(`*Item:* ${data.itemName}`);
    if (data.categoryName) {
      lines.push(`*Categoria:* ${data.categoryName}`);
    }
    lines.push('');
    lines.push('*Restante:*');
    lines.push(`*${data.currentQuantity} ${data.unit || 'un'}*`);
    lines.push('');
    lines.push('*REABASTECIMENTO URGENTE!*');
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  formatStockOut(data: {
    itemName: string;
    categoryName?: string;
    category?: string;
    lastMovement?: string;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const categoryName = data.categoryName || data.category;

    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'ESTOQUE ESGOTADO'));
    lines.push('');
    lines.push('*SEM ESTOQUE DISPONÍVEL*');
    lines.push('');
    lines.push(`*Item:* ${data.itemName}`);
    if (categoryName) {
      lines.push(`*Categoria:* ${categoryName}`);
    }
    if (data.lastMovement) {
      lines.push(`*Última movimentação:* ${data.lastMovement}`);
    }
    lines.push('');
    lines.push('*Quantidade:* 0 unidades');
    lines.push('');
    lines.push('*AÇÃO IMEDIATA NECESSÁRIA!*');
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  formatItemNeedingOrder(data: {
    items?: Array<{
      name: string;
      currentQuantity: number;
      reorderPoint: number;
      suggestedQuantity?: number;
      unit?: string;
    }>;
    totalItems?: number;
    // Single-item payload fields (item.reorder_required emits ONE item, not a
    // list — see item.listener.ts handleReorderRequired). Used as fallback when
    // `items` is missing/not an array so the formatter never throws.
    itemName?: string;
    currentQuantity?: number;
    reorderPoint?: number;
    suggestedOrderQuantity?: number;
    unit?: string;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const items =
      Array.isArray(data.items) && data.items.length > 0
        ? data.items
        : [
            {
              name: data.itemName || 'Item',
              currentQuantity: data.currentQuantity ?? 0,
              reorderPoint: data.reorderPoint ?? 0,
              suggestedQuantity: data.suggestedOrderQuantity,
              unit: data.unit,
            },
          ];
    const totalItems = data.totalItems ?? items.length;

    const itemsList = items
      .slice(0, 5)
      .map(
        (item, index) =>
          `${index + 1}. *${item.name}*\n   ${item.currentQuantity} ${item.unit || 'un'}${item.suggestedQuantity ? ` → ${item.suggestedQuantity}` : ''}`,
      )
      .join('\n\n');

    const moreItems =
      totalItems > 5
        ? `\n\n_...e mais ${totalItems - 5} item${totalItems - 5 !== 1 ? 'ns' : ''}_`
        : '';

    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'ITENS PRECISAM REABASTECIMENTO'));
    lines.push('');
    lines.push(
      `*${totalItems} item${totalItems !== 1 ? 'ns' : ''} abaixo do ponto de reabastecimento*`,
    );
    lines.push('');
    lines.push(`${itemsList}${moreItems}`);
    lines.push('');
    lines.push('_Criar pedido de compra para estes itens_');
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  // ═══════════════════════════════════════════════════════════════
  // SERVICE ORDER NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════

  formatServiceOrderCreated(data: {
    serviceOrderDescription: string;
    taskName: string;
    // Listeners supply `type`; older code used `serviceOrderType`. Accept both.
    serviceOrderType?: string;
    type?: string;
    assignedTo?: string;
    dueDate?: string;
    creatorName?: string;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const serviceOrderType = data.serviceOrderType ?? data.type ?? '';

    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'NOVA ORDEM DE SERVIÇO'));
    lines.push('');
    lines.push(`*Descrição:* ${data.serviceOrderDescription}`);
    lines.push('');
    lines.push(`*Tarefa:* ${data.taskName}`);
    lines.push('');
    lines.push(`*Tipo:* ${serviceOrderType}`);
    if (data.assignedTo) {
      lines.push(`*Responsável:* ${data.assignedTo}`);
    }
    if (data.dueDate) {
      lines.push(`*Prazo:* ${data.dueDate}`);
    }
    // Actor names are never rendered in notification text (creatorName is kept
    // in the payload for compatibility but intentionally not displayed).
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  formatServiceOrderStatusChanged(data: {
    serviceOrderDescription: string;
    taskName: string;
    oldStatus?: string;
    newStatus?: string;
    // Accept the oldValue/newValue field-contract shape as well.
    oldValue?: string;
    newValue?: string;
    changedByName?: string;
    changedBy?: string;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const oldStatus = data.oldStatus ?? data.oldValue ?? '';
    const newStatus = data.newStatus ?? data.newValue ?? '';

    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'ORDEM DE SERVIÇO ATUALIZADA'));
    lines.push('');
    lines.push(`*Ordem:* ${data.serviceOrderDescription}`);
    lines.push('');
    lines.push(`*Tarefa:* ${data.taskName}`);
    lines.push('');
    lines.push(`*Status:* ${oldStatus} → *${newStatus}*`);
    // Actor names are never rendered in notification text (changedBy/changedByName
    // stay in metadata for routing/audit only).
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  formatArtworkWaitingApproval(data: {
    serviceOrderDescription: string;
    taskName: string;
    artistName?: string;
    filesCount?: number;
    importance?: Importance;
    url: string;
  }): WhatsAppMessageFormat {
    const lines: string[] = [];
    lines.push(this.titleLine(data.importance, 'ARTE AGUARDANDO APROVAÇÃO'));
    lines.push('');
    lines.push(`*Ordem:* ${data.serviceOrderDescription}`);
    lines.push('');
    lines.push(`*Tarefa:* ${data.taskName}`);
    // Actor names are never rendered in notification text (artistName is the
    // user who submitted the artwork — kept in the payload, not displayed).
    if (data.filesCount) {
      lines.push(`*Arquivos:* ${data.filesCount}`);
    }
    lines.push('');
    lines.push('_Revisar e aprovar a arte_');
    lines.push(...this.linkLines(data.url));

    return this.wrap(lines);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * The single emoji a message is allowed to carry — the importance marker on
   * the title line. NORMAL/LOW → 🔔, HIGH → ⚠️, URGENT → 🚨.
   * Public so other formatters (e.g. the simple fallback) reuse the same map.
   */
  getImportanceEmoji(importance?: string): string {
    switch ((importance || 'NORMAL').toUpperCase()) {
      case 'URGENT':
        return '🚨';
      case 'HIGH':
        return '⚠️';
      // LOW and NORMAL share the bell.
      default:
        return '🔔';
    }
  }

  /** Build the title line: the lone importance emoji + bold, upper-case title. */
  private titleLine(importance: string | undefined, title: string): string {
    return `${this.getImportanceEmoji(importance)} *${title}*`;
  }

  /** Trailing link block (no emoji), or nothing when there is no URL. */
  private linkLines(url?: string): string[] {
    if (!url) {
      return [];
    }
    return ['', '*Ver detalhes:*', url];
  }

  /** Join lines into the final text + fallbackText shape. */
  private wrap(lines: string[]): WhatsAppMessageFormat {
    const text = lines.join('\n');
    return {
      text,
      fallbackText: text,
    };
  }

  /**
   * Format generic notification with consistent structure.
   * Title carries the lone importance emoji; body and metadata stay emoji-free.
   */
  formatGenericNotification(data: {
    title: string;
    body: string;
    url?: string;
    metadata?: Record<string, any>;
    importance?: Importance;
  }): WhatsAppMessageFormat {
    const lines: string[] = [];

    // Title with the lone importance emoji
    if (data.title) {
      lines.push(this.titleLine(data.importance, data.title.toUpperCase()));
      lines.push('');
    }

    // Body
    if (data.body) {
      lines.push(data.body);
    }

    // Metadata fields (only user-facing, whitelisted ones)
    if (data.metadata) {
      // WHITELIST of keys that are safe to display to end users in the generic
      // fallback. Any key NOT in this set is suppressed, so future enum-bearing
      // or internal metadata keys can never leak raw into a WhatsApp message.
      const displayableKeys = new Set([
        'dueDate',
        'priority',
        'sector',
        'sectorName',
        'customer',
        'customerName',
        'assignedTo',
        'value',
        'quantity',
        'deadline',
        'location',
      ]);

      const metadataLines: string[] = [];
      Object.entries(data.metadata).forEach(([key, value]) => {
        if (!displayableKeys.has(key)) {
          return;
        }

        // Only add non-empty, non-object values
        if (value !== null && value !== undefined && value !== '' && typeof value !== 'object') {
          const label = this.getMetadataLabel(key);
          metadataLines.push(`${label}: ${value}`);
        }
      });

      if (metadataLines.length > 0) {
        lines.push('');
        lines.push(...metadataLines);
      }
    }

    // URL at the end (no emoji)
    if (data.url) {
      lines.push('');
      lines.push('*Ver mais:*');
      lines.push(data.url);
    }

    return this.wrap(lines);
  }

  private getMetadataLabel(key: string): string {
    const labels: Record<string, string> = {
      dueDate: '*Prazo*',
      deadline: '*Prazo*',
      priority: '*Prioridade*',
      sector: '*Setor*',
      sectorName: '*Setor*',
      customer: '*Cliente*',
      customerName: '*Cliente*',
      assignedTo: '*Responsável*',
      value: '*Valor*',
      quantity: '*Quantidade*',
      location: '*Local*',
    };

    return labels[key] || `*${key}*`;
  }
}
