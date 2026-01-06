import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationService } from '@modules/common/notification/notification.service';
import {
  SECTOR_PRIVILEGES,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_TYPE,
} from '../../../constants/enums';
import { ItemReorderRequiredEvent } from './item.events';

/**
 * Scheduler for daily stock checks and notifications
 * Runs daily to identify items requiring attention
 */
@Injectable()
export class ItemNotificationScheduler {
  private readonly logger = new Logger(ItemNotificationScheduler.name);

  // Target sectors for stock notifications
  private readonly TARGET_SECTORS = [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.WAREHOUSE];

  // Cache to track notifications sent today (prevents duplicate notifications)
  private notificationsSentToday: Set<string> = new Set();
  private lastResetDate: Date = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Reset the daily notification cache at midnight
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async resetNotificationCache(): Promise<void> {
    this.logger.log('Resetting daily notification cache');
    this.notificationsSentToday.clear();
    this.lastResetDate = new Date();
  }

  /**
   * Run daily stock check at 8 AM
   * Identifies items below reorder point and sends aggregated notifications
   */
  @Cron('0 8 * * *', {
    name: 'daily-stock-check',
    timeZone: 'America/Sao_Paulo',
  })
  async runDailyStockCheck(): Promise<void> {
    try {
      this.logger.log('Starting daily stock check...');

      // Find all items that are below or at reorder point
      const lowStockItems = await this.prisma.item.findMany({
        where: {
          isActive: true,
          reorderPoint: {
            not: null,
          },
          quantity: {
            lte: this.prisma.item.fields.reorderPoint,
          },
        },
        include: {
          brand: true,
          category: true,
          supplier: true,
        },
        orderBy: [
          {
            quantity: 'asc', // Most critical items first (lowest stock)
          },
          {
            name: 'asc',
          },
        ],
      });

      if (lowStockItems.length === 0) {
        this.logger.log('No items below reorder point. All stock levels are healthy.');
        return;
      }

      this.logger.log(`Found ${lowStockItems.length} items below reorder point`);

      // Categorize items by urgency
      const outOfStockItems = lowStockItems.filter(item => item.quantity === 0);
      const criticalItems = lowStockItems.filter(
        item => item.quantity > 0 && item.quantity < (item.reorderPoint || 0) * 0.5,
      );
      const lowItems = lowStockItems.filter(
        item =>
          item.quantity > 0 &&
          item.quantity >= (item.reorderPoint || 0) * 0.5 &&
          item.quantity <= (item.reorderPoint || 0),
      );

      // Get target users
      const targetUsers = await this.getTargetUsers();
      if (targetUsers.length === 0) {
        this.logger.warn('No target users found for daily stock check');
        return;
      }

      // Emit individual events for out of stock items (urgent)
      for (const item of outOfStockItems) {
        const cacheKey = `out-of-stock-${item.id}`;
        if (!this.notificationsSentToday.has(cacheKey)) {
          // Convert Prisma item to Item type for event emission
          const itemForEvent = item as any;
          this.eventEmitter.emit('item.out-of-stock', { item: itemForEvent });
          this.notificationsSentToday.add(cacheKey);
        }
      }

      // Emit reorder required events for items with defined reorder quantities
      for (const item of lowStockItems) {
        if (item.reorderQuantity && item.reorderQuantity > 0) {
          const cacheKey = `reorder-${item.id}`;
          if (!this.notificationsSentToday.has(cacheKey)) {
            // Convert Prisma item to Item type for event emission
            const itemForEvent = item as any;
            this.eventEmitter.emit(
              'item.reorder-required',
              new ItemReorderRequiredEvent(itemForEvent, item.quantity, item.reorderQuantity),
            );
            this.notificationsSentToday.add(cacheKey);
          }
        }
      }

      // Send aggregated notification for multiple low stock items
      if (lowStockItems.length >= 3) {
        await this.sendAggregatedLowStockNotification(
          targetUsers,
          outOfStockItems,
          criticalItems,
          lowItems,
        );
      }

      this.logger.log('Daily stock check completed successfully');
    } catch (error) {
      this.logger.error('Error during daily stock check:', error);
    }
  }

  /**
   * Get users from target sectors who have stock notifications enabled
   */
  private async getTargetUsers(): Promise<string[]> {
    try {
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
          preferences: {
            select: {
              notificationPreferences: {
                where: {
                  notificationType: NOTIFICATION_TYPE.STOCK,
                },
                select: {
                  enabled: true,
                },
              },
            },
          },
        },
      });

      const targetUserIds = users
        .filter(user => {
          if (!user.preferences || !user.preferences.notificationPreferences) {
            return true;
          }
          const stockPreferences = user.preferences.notificationPreferences;
          if (stockPreferences.length === 0) {
            return true;
          }
          return stockPreferences.some(pref => pref.enabled);
        })
        .map(user => user.id);

      return targetUserIds;
    } catch (error) {
      this.logger.error('Error fetching target users:', error);
      return [];
    }
  }

  /**
   * Send aggregated notification for multiple low stock items
   * Groups items by urgency to provide actionable insights
   */
  private async sendAggregatedLowStockNotification(
    userIds: string[],
    outOfStock: any[],
    critical: any[],
    low: any[],
  ): Promise<void> {
    try {
      const cacheKey = 'daily-aggregated-stock-check';
      if (this.notificationsSentToday.has(cacheKey)) {
        this.logger.log('Aggregated stock notification already sent today');
        return;
      }

      const totalItems = outOfStock.length + critical.length + low.length;

      // Build notification body with categorized items
      let body = `Resumo diário de estoque - ${totalItems} itens requerem atenção:\n\n`;

      // Out of stock items (most urgent)
      if (outOfStock.length > 0) {
        body += `🔴 ESGOTADOS (${outOfStock.length}):\n`;
        const displayItems = outOfStock.slice(0, 5);
        displayItems.forEach(item => {
          body += `• ${item.name}${item.uniCode ? ` (${item.uniCode})` : ''}\n`;
        });
        if (outOfStock.length > 5) {
          body += `... e mais ${outOfStock.length - 5} itens esgotados\n`;
        }
        body += '\n';
      }

      // Critical items
      if (critical.length > 0) {
        body += `🟠 CRÍTICOS (${critical.length}):\n`;
        const displayItems = critical.slice(0, 5);
        displayItems.forEach(item => {
          body += `• ${item.name} - ${item.quantity} un. (recompra: ${item.reorderPoint})${item.uniCode ? ` (${item.uniCode})` : ''}\n`;
        });
        if (critical.length > 5) {
          body += `... e mais ${critical.length - 5} itens críticos\n`;
        }
        body += '\n';
      }

      // Low stock items
      if (low.length > 0) {
        body += `🟡 ESTOQUE BAIXO (${low.length}):\n`;
        const displayItems = low.slice(0, 5);
        displayItems.forEach(item => {
          body += `• ${item.name} - ${item.quantity} un. (recompra: ${item.reorderPoint})${item.uniCode ? ` (${item.uniCode})` : ''}\n`;
        });
        if (low.length > 5) {
          body += `... e mais ${low.length - 5} itens com estoque baixo\n`;
        }
        body += '\n';
      }

      body += 'Acesse o sistema para mais detalhes e realizar pedidos de reposição.';

      // Determine importance based on urgency
      let importance = NOTIFICATION_IMPORTANCE.NORMAL;
      if (outOfStock.length > 0) {
        importance = NOTIFICATION_IMPORTANCE.HIGH;
      } else if (critical.length > 0) {
        importance = NOTIFICATION_IMPORTANCE.NORMAL;
      }

      const title = `Verificação Diária de Estoque - ${totalItems} ${totalItems === 1 ? 'item requer' : 'itens requerem'} atenção`;

      // Create batch notifications
      const notificationData = userIds.map(userId => ({
        userId,
        title,
        body,
        type: NOTIFICATION_TYPE.STOCK,
        importance,
        actionUrl: '/inventory/items?filter=low-stock',
        actionType: 'NAVIGATE',
        channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        sentAt: new Date(),
      }));

      if (notificationData.length > 0) {
        await this.notificationService.batchCreateNotifications({
          notifications: notificationData,
        });

        this.notificationsSentToday.add(cacheKey);
        this.logger.log(
          `Sent aggregated low stock notification to ${notificationData.length} users`,
        );
      }
    } catch (error) {
      this.logger.error('Error sending aggregated low stock notification:', error);
    }
  }

  /**
   * Manual trigger for testing purposes
   * Can be called via admin endpoint
   */
  async triggerManualStockCheck(): Promise<{
    success: boolean;
    message: string;
    stats: {
      totalLowStock: number;
      outOfStock: number;
      critical: number;
      low: number;
      notificationsSent: number;
    };
  }> {
    try {
      this.logger.log('Manual stock check triggered');

      const lowStockItems = await this.prisma.item.findMany({
        where: {
          isActive: true,
          reorderPoint: {
            not: null,
          },
          quantity: {
            lte: this.prisma.item.fields.reorderPoint,
          },
        },
        include: {
          brand: true,
          category: true,
          supplier: true,
        },
      });

      const outOfStockItems = lowStockItems.filter(item => item.quantity === 0);
      const criticalItems = lowStockItems.filter(
        item => item.quantity > 0 && item.quantity < (item.reorderPoint || 0) * 0.5,
      );
      const lowItems = lowStockItems.filter(
        item =>
          item.quantity > 0 &&
          item.quantity >= (item.reorderPoint || 0) * 0.5 &&
          item.quantity <= (item.reorderPoint || 0),
      );

      const targetUsers = await this.getTargetUsers();

      if (lowStockItems.length >= 3 && targetUsers.length > 0) {
        await this.sendAggregatedLowStockNotification(
          targetUsers,
          outOfStockItems,
          criticalItems,
          lowItems,
        );
      }

      return {
        success: true,
        message: 'Manual stock check completed',
        stats: {
          totalLowStock: lowStockItems.length,
          outOfStock: outOfStockItems.length,
          critical: criticalItems.length,
          low: lowItems.length,
          notificationsSent: lowStockItems.length >= 3 ? targetUsers.length : 0,
        },
      };
    } catch (error) {
      this.logger.error('Error during manual stock check:', error);
      return {
        success: false,
        message: `Error: ${error.message}`,
        stats: {
          totalLowStock: 0,
          outOfStock: 0,
          critical: 0,
          low: 0,
          notificationsSent: 0,
        },
      };
    }
  }
}
