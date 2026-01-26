import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationService } from '@modules/common/notification/notification.service';
import { DeepLinkService, DeepLinkEntity } from '@modules/common/notification/deep-link.service';
import {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  OrderOverdueEvent,
  OrderItemReceivedEvent,
  OrderCancelledEvent,
} from './order.events';
import {
  SECTOR_PRIVILEGES,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_TYPE,
  NOTIFICATION_ACTION_TYPE,
} from '../../../constants/enums';

/**
 * OrderListener handles order-related events and creates notifications
 * for users in ADMIN, WAREHOUSE, and LOGISTIC sectors
 */
@Injectable()
export class OrderListener {
  private readonly logger = new Logger(OrderListener.name);

  // Target sectors for order notifications
  private readonly TARGET_SECTORS = [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.LOGISTIC,
  ];

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
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

    this.logger.log('Order event listeners registered successfully');
  }

  /**
   * Get users from target sectors who have order notifications enabled
   */
  private async getTargetUsers(): Promise<string[]> {
    try {
      // Get all users with sectors that match target privileges
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          sector: {
            privileges: {
              in: this.TARGET_SECTORS,
            },
          },
        },
        select: {
          id: true,
        },
      });

      const targetUserIds = users.map(user => user.id);

      return targetUserIds;
    } catch (error) {
      this.logger.error('Error fetching target users for order notifications:', error);
      return [];
    }
  }

  /**
   * Create notifications for multiple users
   */
  private async createNotificationsForUsers(
    userIds: string[],
    title: string,
    body: string,
    actionUrl: string,
    importance: NOTIFICATION_IMPORTANCE = NOTIFICATION_IMPORTANCE.NORMAL,
  ): Promise<void> {
    try {
      const notificationData = userIds.map(userId => ({
        userId,
        title,
        body,
        type: NOTIFICATION_TYPE.ORDER, // Fixed: Using correct NOTIFICATION_TYPE for orders
        importance,
        actionUrl,
        actionType: NOTIFICATION_ACTION_TYPE.VIEW_ORDER,
        channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        sentAt: new Date(),
      }));

      if (notificationData.length > 0) {
        await this.notificationService.batchCreateNotifications({
          notifications: notificationData,
        });

        this.logger.log(`Created ${notificationData.length} notifications for order event`);
      }
    } catch (error) {
      this.logger.error('Error creating notifications:', error);
    }
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

      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for order created notification');
        return;
      }

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

      const title = '📦 Novo Pedido Criado';
      const body = `Pedido #${orderNumber} criado para ${supplierName}.\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}`;

      // Generate deep links for web and mobile
      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);
      const actionUrl = JSON.stringify(deepLinks);

      await this.createNotificationsForUsers(
        targetUsers,
        title,
        body,
        actionUrl,
        NOTIFICATION_IMPORTANCE.NORMAL,
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

      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for order status changed notification');
        return;
      }

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

      // Determine importance based on status
      let importance = NOTIFICATION_IMPORTANCE.NORMAL;
      if (event.newStatus === 'OVERDUE' || event.newStatus === 'CANCELLED') {
        importance = NOTIFICATION_IMPORTANCE.HIGH;
      } else if (event.newStatus === 'RECEIVED') {
        importance = NOTIFICATION_IMPORTANCE.NORMAL;
      }

      const title = '🔄 Status do Pedido Alterado';
      const body = `Pedido #${orderNumber} (${supplierName}) mudou de "${oldStatusLabel}" para "${newStatusLabel}".\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}`;

      // Generate deep links for web and mobile
      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);
      const actionUrl = JSON.stringify(deepLinks);

      await this.createNotificationsForUsers(targetUsers, title, body, actionUrl, importance);
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

      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for order overdue notification');
        return;
      }

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
      let importance: NOTIFICATION_IMPORTANCE;

      // Check if this is an upcoming order (negative days) or overdue order
      if (event.daysOverdue < 0) {
        // Upcoming order (due soon)
        const daysUntil = Math.abs(event.daysOverdue);
        const daysText = daysUntil === 1 ? 'amanhã' : `em ${daysUntil} dias`;

        title = '⏰ Pedido Vencendo';
        body = `Pedido #${orderNumber} (${supplierName}) vence ${daysText}.\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}\n\nPor favor, prepare-se para o recebimento.`;
        importance = NOTIFICATION_IMPORTANCE.NORMAL;
      } else {
        // Overdue order
        const daysText = event.daysOverdue === 1 ? '1 dia' : `${event.daysOverdue} dias`;

        title = '🚨 Pedido Atrasado';
        body = `Pedido #${orderNumber} (${supplierName}) está atrasado há ${daysText}.\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}\n\nPor favor, verifique o status do pedido com o fornecedor.`;
        importance = NOTIFICATION_IMPORTANCE.HIGH;
      }

      // Generate deep links for web and mobile
      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);
      const actionUrl = JSON.stringify(deepLinks);

      await this.createNotificationsForUsers(targetUsers, title, body, actionUrl, importance);
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

      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for order item received notification');
        return;
      }

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

      const title = '📥 Item Recebido';
      const body = `Item "${itemName}" recebido do pedido #${orderNumber} (${supplierName}).\n\nQuantidade recebida: ${event.quantity}\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}`;

      // Generate deep links for web and mobile
      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);
      const actionUrl = JSON.stringify(deepLinks);

      await this.createNotificationsForUsers(
        targetUsers,
        title,
        body,
        actionUrl,
        NOTIFICATION_IMPORTANCE.NORMAL,
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
      this.logger.log(
        `Handling order cancelled event for order ${event.order.id}`,
      );

      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for order cancelled notification');
        return;
      }

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

      const title = '❌ Pedido Cancelado';
      const body = `Pedido #${orderNumber} (${supplierName}) foi cancelado.\n\nCancelado por: ${cancelledByName}\nMotivo: ${event.reason || 'Não especificado'}\n\nDescrição: ${order.description || 'Sem descrição'}${itemsSummary}`;

      // Generate deep links for web and mobile
      const deepLinks = this.deepLinkService.generateOrderLinks(order.id);
      const actionUrl = JSON.stringify(deepLinks);

      await this.createNotificationsForUsers(
        targetUsers,
        title,
        body,
        actionUrl,
        NOTIFICATION_IMPORTANCE.HIGH,
      );
    } catch (error) {
      this.logger.error('Error handling order cancelled event:', error);
    }
  }
}
