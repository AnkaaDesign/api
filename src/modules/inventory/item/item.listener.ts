import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationService } from '@modules/common/notification/notification.service';
import {
  ItemLowStockEvent,
  ItemOutOfStockEvent,
  ItemReorderRequiredEvent,
  ItemOverstockEvent,
} from './item.events';
import {
  SECTOR_PRIVILEGES,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_TYPE,
  NOTIFICATION_ACTION_TYPE,
} from '../../../constants/enums';

/**
 * ItemListener handles stock-related events and creates notifications
 * for users in ADMIN and WAREHOUSE sectors only
 */
@Injectable()
export class ItemListener {
  private readonly logger = new Logger(ItemListener.name);

  // Target sectors for stock notifications
  private readonly TARGET_SECTORS = [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.WAREHOUSE];

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {
    this.registerEventListeners();
  }

  /**
   * Register all event listeners
   */
  private registerEventListeners(): void {
    this.eventEmitter.on('item.low-stock', this.handleLowStock.bind(this));
    this.eventEmitter.on('item.out-of-stock', this.handleOutOfStock.bind(this));
    this.eventEmitter.on('item.reorder-required', this.handleReorderRequired.bind(this));
    this.eventEmitter.on('item.overstock', this.handleOverstock.bind(this));

    this.logger.log('Item stock event listeners registered successfully');
  }

  /**
   * Get users from target sectors who have stock notifications enabled
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
      this.logger.error('Error fetching target users for stock notifications:', error);
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
      if (userIds.length === 0) {
        this.logger.warn('No users to notify for stock event');
        return;
      }

      const notificationData = userIds.map(userId => ({
        userId,
        title,
        body,
        type: NOTIFICATION_TYPE.STOCK,
        importance,
        actionUrl,
        actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
        channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        sentAt: new Date(),
      }));

      await this.notificationService.batchCreateNotifications({
        notifications: notificationData,
      });

      this.logger.log(`Created ${notificationData.length} notifications for stock event`);
    } catch (error) {
      this.logger.error('Error creating stock notifications:', error);
    }
  }

  /**
   * Format item details for notification
   */
  private formatItemDetails(item: any): string {
    const details = [];

    if (item.uniCode) {
      details.push(`Código: ${item.uniCode}`);
    }

    if (item.brand?.name) {
      details.push(`Marca: ${item.brand.name}`);
    }

    if (item.category?.name) {
      details.push(`Categoria: ${item.category.name}`);
    }

    return details.length > 0 ? `\n${details.join(' | ')}` : '';
  }

  /**
   * Handle low stock event
   */
  async handleLowStock(event: ItemLowStockEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling low stock event for item ${event.item.id}: ${event.currentQuantity}/${event.reorderPoint}`,
      );

      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for low stock notification');
        return;
      }

      // Fetch item with relations for detailed notification
      const item = await this.prisma.item.findUnique({
        where: { id: event.item.id },
        include: {
          brand: true,
          category: true,
          supplier: true,
        },
      });

      if (!item) {
        this.logger.error(`Item ${event.item.id} not found`);
        return;
      }

      const itemDetails = this.formatItemDetails(item);
      const title = `Estoque Baixo: ${item.name}`;
      const body = `O item "${item.name}" está com estoque baixo.${itemDetails}\n\nEstoque atual: ${event.currentQuantity} unidades\nPonto de recompra: ${event.reorderPoint} unidades\n\nRecomenda-se verificar e realizar pedido de reposição.`;
      const actionUrl = `/inventory/items/${item.id}`;

      await this.createNotificationsForUsers(
        targetUsers,
        title,
        body,
        actionUrl,
        NOTIFICATION_IMPORTANCE.NORMAL,
      );
    } catch (error) {
      this.logger.error('Error handling low stock event:', error);
    }
  }

  /**
   * Handle out of stock event
   */
  async handleOutOfStock(event: ItemOutOfStockEvent): Promise<void> {
    try {
      this.logger.log(`Handling out of stock event for item ${event.item.id}`);

      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for out of stock notification');
        return;
      }

      // Fetch item with relations for detailed notification
      const item = await this.prisma.item.findUnique({
        where: { id: event.item.id },
        include: {
          brand: true,
          category: true,
          supplier: true,
        },
      });

      if (!item) {
        this.logger.error(`Item ${event.item.id} not found`);
        return;
      }

      const itemDetails = this.formatItemDetails(item);
      const supplierInfo = item.supplier
        ? `\nFornecedor: ${item.supplier.fantasyName || item.supplier.corporateName}`
        : '';

      const title = `Estoque Esgotado: ${item.name}`;
      const body = `O item "${item.name}" está ESGOTADO.${itemDetails}${supplierInfo}\n\nEstoque atual: 0 unidades\n\nAção urgente necessária para repor o item.`;
      const actionUrl = `/inventory/items/${item.id}`;

      await this.createNotificationsForUsers(
        targetUsers,
        title,
        body,
        actionUrl,
        NOTIFICATION_IMPORTANCE.HIGH,
      );
    } catch (error) {
      this.logger.error('Error handling out of stock event:', error);
    }
  }

  /**
   * Handle reorder required event
   */
  async handleReorderRequired(event: ItemReorderRequiredEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling reorder required event for item ${event.item.id}: ${event.currentQuantity} (reorder qty: ${event.reorderQuantity})`,
      );

      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for reorder required notification');
        return;
      }

      // Fetch item with relations for detailed notification
      const item = await this.prisma.item.findUnique({
        where: { id: event.item.id },
        include: {
          brand: true,
          category: true,
          supplier: true,
        },
      });

      if (!item) {
        this.logger.error(`Item ${event.item.id} not found`);
        return;
      }

      const itemDetails = this.formatItemDetails(item);
      const supplierInfo = item.supplier
        ? `\nFornecedor sugerido: ${item.supplier.fantasyName || item.supplier.corporateName}`
        : '';
      const leadTimeInfo = item.estimatedLeadTime
        ? `\nPrazo estimado de entrega: ${item.estimatedLeadTime} dias`
        : '';

      const title = `Recompra Necessária: ${item.name}`;
      const body = `O item "${item.name}" requer recompra.${itemDetails}${supplierInfo}${leadTimeInfo}\n\nEstoque atual: ${event.currentQuantity} unidades\nQuantidade sugerida para pedido: ${event.reorderQuantity} unidades\n\nRealize o pedido de compra.`;
      const actionUrl = `/inventory/items/${item.id}`;

      await this.createNotificationsForUsers(
        targetUsers,
        title,
        body,
        actionUrl,
        NOTIFICATION_IMPORTANCE.NORMAL,
      );
    } catch (error) {
      this.logger.error('Error handling reorder required event:', error);
    }
  }

  /**
   * Handle overstock event
   */
  async handleOverstock(event: ItemOverstockEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling overstock event for item ${event.item.id}: ${event.currentQuantity}/${event.maxQuantity}`,
      );

      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for overstock notification');
        return;
      }

      // Fetch item with relations for detailed notification
      const item = await this.prisma.item.findUnique({
        where: { id: event.item.id },
        include: {
          brand: true,
          category: true,
        },
      });

      if (!item) {
        this.logger.error(`Item ${event.item.id} not found`);
        return;
      }

      const itemDetails = this.formatItemDetails(item);
      const excess = event.currentQuantity - event.maxQuantity;

      const title = `Excesso de Estoque: ${item.name}`;
      const body = `O item "${item.name}" está com excesso de estoque.${itemDetails}\n\nEstoque atual: ${event.currentQuantity} unidades\nEstoque máximo: ${event.maxQuantity} unidades\nExcesso: ${excess} unidades\n\nVerifique possíveis desperdícios ou ajuste o estoque máximo.`;
      const actionUrl = `/inventory/items/${item.id}`;

      await this.createNotificationsForUsers(
        targetUsers,
        title,
        body,
        actionUrl,
        NOTIFICATION_IMPORTANCE.LOW,
      );
    } catch (error) {
      this.logger.error('Error handling overstock event:', error);
    }
  }
}
