import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  OrderOverdueEvent,
  OrderItemReceivedEvent,
  OrderCancelledEvent,
  OrderItemEnteredInventoryEvent,
} from './order.events';

/**
 * OrderListener handles order-related events and dispatches notifications
 * using database configuration-based approach (checks config enablement + user preferences).
 *
 * Config keys:
 * - order.created
 * - order.status.changed
 * - order.overdue
 * - order.item.received
 * - order.cancelled
 * - order.item.entered_inventory
 */
@Injectable()
export class OrderListener {
  private readonly logger = new Logger(OrderListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly deepLinkService: DeepLinkService,
  ) {
    this.registerEventListeners();
  }

  /**
   * Register all event listeners
   */
  private registerEventListeners(): void {
    this.eventEmitter.on('order.created', this.handleOrderCreated.bind(this));
    this.eventEmitter.on('order.status.changed', this.handleOrderStatusChanged.bind(this));
    this.eventEmitter.on('order.overdue', this.handleOrderOverdue.bind(this));
    this.eventEmitter.on('order.item.received', this.handleOrderItemReceived.bind(this));
    this.eventEmitter.on('order.cancelled', this.handleOrderCancelled.bind(this));
    this.eventEmitter.on(
      'order.item.entered_inventory',
      this.handleOrderItemEnteredInventory.bind(this),
    );

    this.logger.log('Order event listeners registered successfully');
  }

  /**
   * Generate order items summary for notification body
   */
  private generateOrderItemsSummary(order: any): string {
    if (!order.items || order.items.length === 0) {
      return 'Nenhum item no pedido.';
    }

    const itemCount = order.items.length;
    const totalQuantity = order.items.reduce(
      (sum: number, item: any) => sum + item.orderedQuantity,
      0,
    );

    // Show first few items
    const itemsList = order.items
      .slice(0, 3)
      .map((item: any) => {
        const itemName = item.item?.name || item.temporaryItemDescription || 'Item desconhecido';
        return `- ${itemName} (${item.orderedQuantity} un.)`;
      })
      .join('\n');

    const moreItems = itemCount > 3 ? `\n... e mais ${itemCount - 3} itens` : '';

    return `\n\nItens do pedido (${itemCount} itens, ${totalQuantity} unidades):\n${itemsList}${moreItems}`;
  }

  /**
   * Handle order created event
   */
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    try {
      this.logger.log(`Handling order created event for order ${event.order.id}`);

      // Fetch order with supplier and items
      const order = await this.prisma.order.findUnique({
        where: { id: event.order.id },
        include: {
          supplier: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!order) {
        this.logger.error(`Order ${event.order.id} not found`);
        return;
      }

      const supplierName = order.supplier?.fantasyName || 'Fornecedor não especificado';
      const orderNumber = order.id.slice(-8).toUpperCase();
      const itemsSummary = this.generateOrderItemsSummary(order);

      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);

      await this.dispatchService.dispatchByConfiguration(
        'order.created',
        event.createdBy.id,
        {
          entityType: 'Order',
          entityId: order.id,
          action: 'created',
          data: {
            orderNumber,
            supplierName,
            changedBy: event.createdBy.name,
            description: order.description || 'Sem descrição',
            itemsSummary,
          },
          metadata: {
            orderId: order.id,
            orderNumber,
            supplierName,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/pedidos/${order.id}`,
            relatedEntityType: 'ORDER',
            title: 'Novo Pedido Criado',
            body: `Pedido #${orderNumber} criado para ${supplierName}.\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}`,
          },
        },
      );
    } catch (error) {
      this.logger.error('Error handling order created event:', error);
    }
  }

  /**
   * Handle order status changed event
   */
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling order status changed event for order ${event.order.id}: ${event.oldStatus} -> ${event.newStatus}`,
      );

      // Fetch order with supplier and items
      const order = await this.prisma.order.findUnique({
        where: { id: event.order.id },
        include: {
          supplier: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!order) {
        this.logger.error(`Order ${event.order.id} not found`);
        return;
      }

      const supplierName = order.supplier?.fantasyName || 'Fornecedor não especificado';
      const orderNumber = order.id.slice(-8).toUpperCase();
      const itemsSummary = this.generateOrderItemsSummary(order);

      // Status labels
      const statusLabels: Record<string, string> = {
        CREATED: 'Criado',
        PARTIALLY_FULFILLED: 'Parcialmente Atendido',
        FULFILLED: 'Atendido',
        OVERDUE: 'Atrasado',
        PARTIALLY_RECEIVED: 'Parcialmente Recebido',
        RECEIVED: 'Recebido',
        CANCELLED: 'Cancelado',
      };

      const oldStatusLabel = statusLabels[event.oldStatus] || event.oldStatus;
      const newStatusLabel = statusLabels[event.newStatus] || event.newStatus;

      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);

      await this.dispatchService.dispatchByConfiguration(
        'order.status.changed',
        event.changedBy.id,
        {
          entityType: 'Order',
          entityId: order.id,
          action: 'status_changed',
          data: {
            orderNumber,
            supplierName,
            oldStatus: event.oldStatus,
            newStatus: event.newStatus,
            oldStatusLabel,
            newStatusLabel,
            changedBy: event.changedBy.name,
            description: order.description || 'Sem descrição',
            itemsSummary,
          },
          metadata: {
            orderId: order.id,
            orderNumber,
            supplierName,
            oldStatus: event.oldStatus,
            newStatus: event.newStatus,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/pedidos/${order.id}`,
            relatedEntityType: 'ORDER',
            title: 'Status do Pedido Alterado',
            body: `Pedido #${orderNumber} (${supplierName}) mudou de "${oldStatusLabel}" para "${newStatusLabel}".\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}`,
          },
        },
      );
    } catch (error) {
      this.logger.error('Error handling order status changed event:', error);
    }
  }

  /**
   * Handle order overdue event
   * Also handles upcoming orders (when daysOverdue is negative)
   */
  async handleOrderOverdue(event: OrderOverdueEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling order overdue event for order ${event.order.id} (${event.daysOverdue} days overdue)`,
      );

      // Fetch order with supplier and items
      const order = await this.prisma.order.findUnique({
        where: { id: event.order.id },
        include: {
          supplier: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!order) {
        this.logger.error(`Order ${event.order.id} not found`);
        return;
      }

      const supplierName = order.supplier?.fantasyName || 'Fornecedor não especificado';
      const orderNumber = order.id.slice(-8).toUpperCase();
      const itemsSummary = this.generateOrderItemsSummary(order);

      let title: string;
      let body: string;

      // Check if this is an upcoming order (negative days) or overdue order
      if (event.daysOverdue < 0) {
        // Upcoming order (due soon)
        const daysUntil = Math.abs(event.daysOverdue);
        const daysText = daysUntil === 1 ? 'amanhã' : `em ${daysUntil} dias`;

        title = 'Pedido Vencendo';
        body = `Pedido #${orderNumber} (${supplierName}) vence ${daysText}.\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}\n\nPor favor, prepare-se para o recebimento.`;
      } else {
        // Overdue order
        const daysText = event.daysOverdue === 1 ? '1 dia' : `${event.daysOverdue} dias`;

        title = 'Pedido Atrasado';
        body = `Pedido #${orderNumber} (${supplierName}) está atrasado há ${daysText}.\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}\n\nPor favor, verifique o status do pedido com o fornecedor.`;
      }

      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);

      await this.dispatchService.dispatchByConfiguration(
        'order.overdue',
        'system', // Cron-triggered, no triggering user
        {
          entityType: 'Order',
          entityId: order.id,
          action: 'overdue',
          data: {
            orderNumber,
            supplierName,
            daysOverdue: event.daysOverdue,
            description: order.description || 'Sem descrição',
            itemsSummary,
          },
          metadata: {
            orderId: order.id,
            orderNumber,
            supplierName,
            daysOverdue: event.daysOverdue,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/pedidos/${order.id}`,
            relatedEntityType: 'ORDER',
            title,
            body,
          },
        },
      );
    } catch (error) {
      this.logger.error('Error handling order overdue event:', error);
    }
  }

  /**
   * Handle order item received event
   */
  async handleOrderItemReceived(event: OrderItemReceivedEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling order item received event for order ${event.order.id}, item ${event.item.id}`,
      );

      // Fetch order with supplier and items
      const order = await this.prisma.order.findUnique({
        where: { id: event.order.id },
        include: {
          supplier: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!order) {
        this.logger.error(`Order ${event.order.id} not found`);
        return;
      }

      const supplierName = order.supplier?.fantasyName || 'Fornecedor não especificado';
      const orderNumber = order.id.slice(-8).toUpperCase();
      const itemName =
        event.item.item?.name || event.item.temporaryItemDescription || 'Item desconhecido';
      const itemsSummary = this.generateOrderItemsSummary(order);

      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);

      // Use receivedBy from event if available, otherwise 'system'
      const triggeringUserId = (event as any).receivedBy?.id || 'system';

      await this.dispatchService.dispatchByConfiguration(
        'order.item.received',
        triggeringUserId,
        {
          entityType: 'Order',
          entityId: order.id,
          action: 'item_received',
          data: {
            orderNumber,
            supplierName,
            itemName,
            quantity: event.quantity,
            changedBy: (event as any).receivedBy?.name || 'Sistema',
            description: order.description || 'Sem descrição',
            itemsSummary,
          },
          metadata: {
            orderId: order.id,
            orderNumber,
            supplierName,
            itemName,
            quantity: event.quantity,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/pedidos/${order.id}`,
            relatedEntityType: 'ORDER',
            title: 'Item Recebido',
            body: `Item "${itemName}" recebido do pedido #${orderNumber} (${supplierName}).\n\nQuantidade recebida: ${event.quantity}\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}`,
          },
        },
      );
    } catch (error) {
      this.logger.error('Error handling order item received event:', error);
    }
  }

  /**
   * Handle order cancelled event
   */
  async handleOrderCancelled(event: OrderCancelledEvent): Promise<void> {
    try {
      this.logger.log(`Handling order cancelled event for order ${event.order.id}`);

      // Fetch order with supplier and items
      const order = await this.prisma.order.findUnique({
        where: { id: event.order.id },
        include: {
          supplier: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!order) {
        this.logger.error(`Order ${event.order.id} not found`);
        return;
      }

      const supplierName = order.supplier?.fantasyName || 'Fornecedor não especificado';
      const orderNumber = order.id.slice(-8).toUpperCase();
      const itemsSummary = this.generateOrderItemsSummary(order);
      const cancelledByName = event.cancelledBy.name || 'Usuário desconhecido';

      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);

      await this.dispatchService.dispatchByConfiguration(
        'order.cancelled',
        event.cancelledBy.id,
        {
          entityType: 'Order',
          entityId: order.id,
          action: 'cancelled',
          data: {
            orderNumber,
            supplierName,
            cancelledByName,
            reason: event.reason || 'Não especificado',
            changedBy: cancelledByName,
            description: order.description || 'Sem descrição',
            itemsSummary,
          },
          metadata: {
            orderId: order.id,
            orderNumber,
            supplierName,
            cancelledByName,
            reason: event.reason,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/pedidos/${order.id}`,
            relatedEntityType: 'ORDER',
            title: 'Pedido Cancelado',
            body: `Pedido #${orderNumber} (${supplierName}) foi cancelado.\n\nCancelado por: ${cancelledByName}\nMotivo: ${event.reason || 'Não especificado'}\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}`,
          },
        },
      );
    } catch (error) {
      this.logger.error('Error handling order cancelled event:', error);
    }
  }

  /**
   * Handle order item entered inventory event
   * Triggered when an inbound activity with ORDER_RECEIVED reason is created,
   * effectively moving an order item into inventory stock.
   */
  async handleOrderItemEnteredInventory(event: OrderItemEnteredInventoryEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling order item entered inventory event for order ${event.orderId}, item ${event.itemId}, quantity ${event.quantity}`,
      );

      // Fetch order with supplier and items
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
        include: {
          supplier: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!order) {
        this.logger.error(`Order ${event.orderId} not found`);
        return;
      }

      // Fetch the specific item details
      const item = await this.prisma.item.findUnique({
        where: { id: event.itemId },
        include: {
          brand: true,
          category: true,
        },
      });

      if (!item) {
        this.logger.error(`Item ${event.itemId} not found`);
        return;
      }

      const supplierName = order.supplier?.fantasyName || 'Fornecedor não especificado';
      const orderNumber = order.id.slice(-8).toUpperCase();
      const itemName = item.name;
      const itemCode = item.uniCode || '';
      const categoryName = item.category?.name || '';

      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);

      const triggeringUserId = event.userId || 'system';

      await this.dispatchService.dispatchByConfiguration(
        'order.item.entered_inventory',
        triggeringUserId,
        {
          entityType: 'Order',
          entityId: order.id,
          action: 'item_entered_inventory',
          data: {
            orderNumber,
            supplierName,
            itemName,
            itemCode,
            categoryName,
            quantity: event.quantity,
            currentStock: item.quantity,
            changedBy: triggeringUserId !== 'system' ? triggeringUserId : 'Sistema',
          },
          metadata: {
            orderId: order.id,
            orderNumber,
            supplierName,
            itemId: event.itemId,
            itemName,
            quantity: event.quantity,
            activityId: event.activityId,
          },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/pedidos/${order.id}`,
            relatedEntityType: 'ORDER',
            title: 'Item Entrou no Estoque',
            body: `O item "${itemName}"${itemCode ? ` (${itemCode})` : ''} do pedido #${orderNumber} (${supplierName}) entrou no estoque.\n\nQuantidade adicionada: ${event.quantity} unidades${categoryName ? `\nCategoria: ${categoryName}` : ''}\nEstoque atual: ${item.quantity} unidades`,
          },
        },
      );
    } catch (error) {
      this.logger.error('Error handling order item entered inventory event:', error);
    }
  }
}
