// apps/api/src/modules/inventory/services/stock-notification.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '@modules/common/notification/notification.service';
import {
  DeepLinkService,
  DeepLinkEntity,
} from '@modules/common/notification/deep-link.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
  STOCK_LEVEL,
  SECTOR_PRIVILEGES,
} from '../../../constants/enums';
import { StockCalculationResult } from './atomic-stock-calculator.service';
import { PrismaTransaction } from '../activity/repositories/activity.repository';

/**
 * Stock event types for notifications
 */
export enum STOCK_EVENT_TYPE {
  LOW = 'low',
  CRITICAL = 'critical',
  OUT_OF_STOCK = 'out',
  REPLENISHED = 'restock',
}

/**
 * Interface for stock notification metadata
 */
export interface StockNotificationMetadata {
  itemId: string;
  itemName: string;
  itemCode: string | null;
  currentQuantity: number;
  previousQuantity: number;
  reorderPoint: number | null;
  criticalThreshold: number | null;
  lowThreshold: number | null;
  stockLevel: STOCK_LEVEL;
  warehouse: string | null;
  category: string | null;
  brand: string | null;
  eventType: STOCK_EVENT_TYPE;
  triggeredAt: Date;
}

/**
 * Service responsible for creating and managing stock-related notifications
 *
 * This service integrates with the NotificationService to send alerts to users
 * with ADMIN and WAREHOUSE privileges when stock events occur.
 *
 * Features:
 * - Threshold-based notifications (low, critical, out of stock, replenished)
 * - Smart deduplication to avoid notification spam
 * - Rich metadata including product details and deep links
 * - Role-based targeting (ADMIN, WAREHOUSE)
 * - User preference support (OPTIONAL notifications)
 */
@Injectable()
export class StockNotificationService {
  private readonly logger = new Logger(StockNotificationService.name);

  // Cache to track recent notifications and prevent spam
  // Key: itemId-eventType, Value: timestamp
  private notificationCache = new Map<string, number>();

  // Cooldown period in milliseconds (5 minutes)
  private readonly NOTIFICATION_COOLDOWN = 5 * 60 * 1000;

  constructor(
    private readonly notificationService: NotificationService,
    private readonly deepLinkService: DeepLinkService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Process stock calculations and trigger notifications for threshold events
   * This is the main entry point called from AtomicStockUpdateService
   *
   * @param calculations - Array of stock calculation results
   * @param tx - Prisma transaction
   * @returns Number of notifications created
   */
  async processStockNotifications(
    calculations: StockCalculationResult[],
    tx: PrismaTransaction,
  ): Promise<number> {
    let notificationsCreated = 0;

    for (const calculation of calculations) {
      try {
        const created = await this.checkAndNotify(calculation, tx);
        if (created) {
          notificationsCreated++;
        }
      } catch (error) {
        this.logger.error(
          `Error processing notification for item ${calculation.itemId}: ${error.message}`,
          error,
        );
        // Continue processing other items even if one fails
      }
    }

    this.logger.log(`Created ${notificationsCreated} stock notifications`);
    return notificationsCreated;
  }

  /**
   * Check stock level and create notification if threshold is crossed
   * Implements smart deduplication to prevent notification spam
   *
   * @param calculation - Stock calculation result
   * @param tx - Prisma transaction
   * @returns true if notification was created
   */
  private async checkAndNotify(
    calculation: StockCalculationResult,
    tx: PrismaTransaction,
  ): Promise<boolean> {
    // Determine if we need to notify based on stock level
    const eventType = this.determineEventType(calculation);

    if (!eventType) {
      // Stock level is healthy, no notification needed
      return false;
    }

    // Check if we recently sent this notification (deduplication)
    if (this.isRecentlyNotified(calculation.itemId, eventType)) {
      this.logger.debug(
        `Skipping notification for item ${calculation.itemId} - ${eventType}: recently notified`,
      );
      return false;
    }

    // Get full item details for rich notification
    const item = await this.getItemDetails(calculation.itemId, tx);

    if (!item) {
      this.logger.warn(`Item ${calculation.itemId} not found for notification`);
      return false;
    }

    // Build notification metadata
    const metadata = this.buildMetadata(calculation, item, eventType);

    // Create notification for users with ADMIN or WAREHOUSE roles
    await this.createStockNotification(metadata, tx);

    // Update cache to prevent spam
    this.updateNotificationCache(calculation.itemId, eventType);

    return true;
  }

  /**
   * Determine the event type based on stock level change
   * Returns null if no notification is needed
   *
   * Logic:
   * - OUT_OF_STOCK: quantity is 0
   * - CRITICAL: stock level is CRITICAL
   * - LOW: stock level is LOW
   * - REPLENISHED: stock was low/critical and is now optimal
   *
   * @param calculation - Stock calculation result
   * @returns Event type or null
   */
  private determineEventType(calculation: StockCalculationResult): STOCK_EVENT_TYPE | null {
    const { stockLevel, finalQuantity, currentQuantity } = calculation;

    // Out of stock
    if (finalQuantity === 0 && currentQuantity > 0) {
      return STOCK_EVENT_TYPE.OUT_OF_STOCK;
    }

    // Critical level
    if (stockLevel === STOCK_LEVEL.CRITICAL) {
      return STOCK_EVENT_TYPE.CRITICAL;
    }

    // Low level
    if (stockLevel === STOCK_LEVEL.LOW) {
      return STOCK_EVENT_TYPE.LOW;
    }

    // Replenished: was low/critical, now optimal
    if (
      finalQuantity > currentQuantity &&
      stockLevel === STOCK_LEVEL.OPTIMAL &&
      calculation.reorderPoint &&
      currentQuantity < calculation.reorderPoint
    ) {
      return STOCK_EVENT_TYPE.REPLENISHED;
    }

    return null;
  }

  /**
   * Check if we recently sent a notification for this item and event type
   * Prevents notification spam by enforcing a cooldown period
   *
   * @param itemId - Item ID
   * @param eventType - Event type
   * @returns true if recently notified
   */
  private isRecentlyNotified(itemId: string, eventType: STOCK_EVENT_TYPE): boolean {
    const cacheKey = `${itemId}-${eventType}`;
    const lastNotified = this.notificationCache.get(cacheKey);

    if (!lastNotified) {
      return false;
    }

    const timeSinceLastNotification = Date.now() - lastNotified;
    return timeSinceLastNotification < this.NOTIFICATION_COOLDOWN;
  }

  /**
   * Update notification cache with current timestamp
   *
   * @param itemId - Item ID
   * @param eventType - Event type
   */
  private updateNotificationCache(itemId: string, eventType: STOCK_EVENT_TYPE): void {
    const cacheKey = `${itemId}-${eventType}`;
    this.notificationCache.set(cacheKey, Date.now());

    // Clean up old cache entries (older than 1 hour)
    this.cleanupCache();
  }

  /**
   * Clean up old cache entries to prevent memory leaks
   */
  private cleanupCache(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const [key, timestamp] of this.notificationCache.entries()) {
      if (now - timestamp > maxAge) {
        this.notificationCache.delete(key);
      }
    }
  }

  /**
   * Get full item details including relations
   *
   * @param itemId - Item ID
   * @param tx - Prisma transaction
   * @returns Item with relations or null
   */
  private async getItemDetails(itemId: string, tx: PrismaTransaction) {
    return tx.item.findUnique({
      where: { id: itemId },
      include: {
        brand: { select: { name: true } },
        category: { select: { name: true } },
      },
    });
  }

  /**
   * Build notification metadata with all relevant information
   *
   * @param calculation - Stock calculation result
   * @param item - Full item details
   * @param eventType - Event type
   * @returns Notification metadata
   */
  private buildMetadata(
    calculation: StockCalculationResult,
    item: any,
    eventType: STOCK_EVENT_TYPE,
  ): StockNotificationMetadata {
    // Calculate thresholds
    const criticalThreshold = calculation.reorderPoint
      ? calculation.reorderPoint * 0.9
      : null;
    const lowThreshold = calculation.reorderPoint
      ? calculation.reorderPoint * 1.1
      : null;

    return {
      itemId: calculation.itemId,
      itemName: calculation.itemName,
      itemCode: item.code || null,
      currentQuantity: calculation.finalQuantity,
      previousQuantity: calculation.currentQuantity,
      reorderPoint: calculation.reorderPoint,
      criticalThreshold,
      lowThreshold,
      stockLevel: calculation.stockLevel,
      warehouse: item.warehouse?.name || null,
      category: item.category?.name || null,
      brand: item.brand?.name || null,
      eventType,
      triggeredAt: new Date(),
    };
  }

  /**
   * Create stock notification and send to users with appropriate privileges
   *
   * Creates notifications for users with:
   * - ADMIN role
   * - WAREHOUSE role
   *
   * These are OPTIONAL notifications (users can disable them in preferences)
   *
   * @param metadata - Notification metadata
   * @param tx - Prisma transaction
   */
  private async createStockNotification(
    metadata: StockNotificationMetadata,
    tx: PrismaTransaction,
  ): Promise<void> {
    // Get all users with ADMIN or WAREHOUSE privileges
    const targetUsers = await this.getTargetUsers(tx);

    if (targetUsers.length === 0) {
      this.logger.warn('No ADMIN or WAREHOUSE users found for stock notification');
      return;
    }

    this.logger.log(
      `Creating stock notification for ${targetUsers.length} users (event: ${metadata.eventType})`,
    );

    // Build notification content
    const { title, body } = this.buildNotificationContent(metadata);

    // Build deep links with proper web, mobile, and universal link support
    const deepLinks = this.deepLinkService.generateItemLinks(metadata.itemId);

    // Create notification for each target user
    for (const user of targetUsers) {
      try {
        await this.notificationService.createNotification(
          {
            userId: user.id,
            title,
            body,
            type: NOTIFICATION_TYPE.STOCK,
            channel: [
              NOTIFICATION_CHANNEL.IN_APP,
              NOTIFICATION_CHANNEL.EMAIL,
            ],
            importance: this.getImportance(metadata.eventType),
            actionType: metadata.eventType,
            actionUrl: deepLinks.web,  // Web URL for backward compatibility
            metadata: {
              ...(metadata as any),
              webUrl: deepLinks.web,                  // Web route
              mobileUrl: deepLinks.mobile,            // Mobile app deep link
              universalLink: deepLinks.universalLink, // Universal link for mobile
            },
          },
          { user: true },
          'system',
        );

        this.logger.debug(
          `Created stock notification for user ${user.id}: ${metadata.itemName} - ${metadata.eventType}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to create notification for user ${user.id}: ${error.message}`,
          error,
        );
        // Continue with other users
      }
    }
  }

  /**
   * Get users with ADMIN or WAREHOUSE privileges
   * Only returns active users
   *
   * @param tx - Prisma transaction
   * @returns Array of users
   */
  private async getTargetUsers(tx: PrismaTransaction) {
    return tx.user.findMany({
      where: {
        isActive: true,
        status: { not: 'DISMISSED' },
        OR: [
          {
            sector: {
              privileges: {
                in: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.WAREHOUSE],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
  }

  /**
   * Build notification title and body based on event type and metadata
   *
   * @param metadata - Notification metadata
   * @returns Title and body text
   */
  private buildNotificationContent(metadata: StockNotificationMetadata): {
    title: string;
    body: string;
  } {
    const itemInfo = metadata.itemCode
      ? `${metadata.itemName} (${metadata.itemCode})`
      : metadata.itemName;

    const warehouseInfo = metadata.warehouse ? ` em ${metadata.warehouse}` : '';
    const reorderInfo = metadata.reorderPoint
      ? ` (Ponto de reposição: ${metadata.reorderPoint})`
      : '';

    switch (metadata.eventType) {
      case STOCK_EVENT_TYPE.OUT_OF_STOCK:
        return {
          title: 'Estoque Esgotado',
          body: `${itemInfo}${warehouseInfo} está sem estoque. Quantidade: ${metadata.currentQuantity} unidades${reorderInfo}. Reposição urgente necessária.`,
        };

      case STOCK_EVENT_TYPE.CRITICAL:
        return {
          title: 'Estoque Crítico',
          body: `${itemInfo}${warehouseInfo} atingiu nível crítico. Quantidade: ${metadata.currentQuantity} unidades${reorderInfo}. Reposição recomendada.`,
        };

      case STOCK_EVENT_TYPE.LOW:
        return {
          title: 'Estoque Baixo',
          body: `${itemInfo}${warehouseInfo} está com estoque baixo. Quantidade: ${metadata.currentQuantity} unidades${reorderInfo}. Considere reposição.`,
        };

      case STOCK_EVENT_TYPE.REPLENISHED:
        return {
          title: 'Estoque Reabastecido',
          body: `${itemInfo}${warehouseInfo} foi reabastecido. Quantidade atual: ${metadata.currentQuantity} unidades${reorderInfo}.`,
        };

      default:
        return {
          title: 'Alerta de Estoque',
          body: `${itemInfo}${warehouseInfo} teve alteração no estoque. Quantidade: ${metadata.currentQuantity} unidades.`,
        };
    }
  }

  /**
   * Determine notification importance based on event type
   *
   * @param eventType - Event type
   * @returns Notification importance
   */
  private getImportance(eventType: STOCK_EVENT_TYPE): NOTIFICATION_IMPORTANCE {
    switch (eventType) {
      case STOCK_EVENT_TYPE.OUT_OF_STOCK:
      case STOCK_EVENT_TYPE.CRITICAL:
        return NOTIFICATION_IMPORTANCE.HIGH;

      case STOCK_EVENT_TYPE.LOW:
        return NOTIFICATION_IMPORTANCE.NORMAL;

      case STOCK_EVENT_TYPE.REPLENISHED:
        return NOTIFICATION_IMPORTANCE.LOW;

      default:
        return NOTIFICATION_IMPORTANCE.NORMAL;
    }
  }

  /**
   * @deprecated This method is no longer used. Deep links are now generated inline
   * using deepLinkService.generateItemLinks() for better separation of web/mobile URLs.
   *
   * Build deep link to item/stock page
   * Uses DeepLinkService to generate proper URLs for both web and mobile
   *
   * @param itemId - Item ID
   * @returns JSON string containing web and mobile URLs
   */
  private buildDeepLink(itemId: string): string {
    return this.deepLinkService.generateNotificationActionUrl(
      DeepLinkEntity.Item,
      itemId,
    );
  }

  /**
   * Clear notification cache for a specific item
   * Useful when you want to force a notification even if one was sent recently
   *
   * @param itemId - Item ID
   */
  clearCacheForItem(itemId: string): void {
    const keysToDelete: string[] = [];

    for (const key of this.notificationCache.keys()) {
      if (key.startsWith(`${itemId}-`)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.notificationCache.delete(key));

    this.logger.debug(`Cleared notification cache for item ${itemId}`);
  }

  /**
   * Clear entire notification cache
   * Useful for testing or manual intervention
   */
  clearCache(): void {
    this.notificationCache.clear();
    this.logger.log('Cleared entire notification cache');
  }

  /**
   * Get cache statistics for monitoring
   *
   * @returns Cache stats
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ itemId: string; eventType: string; lastNotified: Date }>;
  } {
    const entries = Array.from(this.notificationCache.entries()).map(([key, timestamp]) => {
      const [itemId, eventType] = key.split('-');
      return {
        itemId,
        eventType,
        lastNotified: new Date(timestamp),
      };
    });

    return {
      size: this.notificationCache.size,
      entries,
    };
  }
}
