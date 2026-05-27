// Stock-event notifications (algorithm-spec §9 + services-spec §A).
// Aggregates threshold crossings per supplier into a single dispatch, with a
// DB-backed 24h cooldown (NotificationCooldown table) so a single supplier
// receives at most one notification per event-type per day. TOOL items are
// excluded ENTIRELY (no LOW/CRITICAL/OUT_OF_STOCK/OVERSTOCKED — spec §11).
// OVERSTOCKED is IN_APP only.

import { Injectable, Logger } from '@nestjs/common';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { DeepLinkService, DeepLinkEntity } from '@modules/common/notification/deep-link.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  ITEM_CATEGORY_TYPE,
  NOTIFICATION_IMPORTANCE,
  SECTOR_PRIVILEGES,
  STOCK_LEVEL,
} from '../../../constants/enums';
import { StockCalculationResult } from './atomic-stock-calculator.service';
import { PrismaTransaction } from '../activity/repositories/activity.repository';
import { isToolType } from '../../../constants/inventory-config';

export enum STOCK_EVENT_TYPE {
  LOW = 'low',
  CRITICAL = 'critical',
  OUT_OF_STOCK = 'out',
  OVERSTOCKED = 'overstocked',
  REPLENISHED = 'restock',
}

const COOLDOWN_TTL_MS = 24 * 60 * 60 * 1000;

interface StockEventItem {
  itemId: string;
  itemName: string;
  itemCode: string | null;
  quantity: number;
  previousQuantity: number;
  reorderPoint: number | null;
  eventType: STOCK_EVENT_TYPE;
  categoryType: ITEM_CATEGORY_TYPE | null;
}

@Injectable()
export class StockNotificationService {
  private readonly logger = new Logger(StockNotificationService.name);

  constructor(
    private readonly dispatchService: NotificationDispatchService,
    private readonly deepLinkService: DeepLinkService,
    private readonly prisma: PrismaService,
  ) {}

  /** Main entry from AtomicStockUpdateService. Groups events per supplier and
   *  fires at most one aggregated dispatch per (supplier, event-type) per 24h. */
  async processStockNotifications(
    calculations: StockCalculationResult[],
    tx: PrismaTransaction,
  ): Promise<number> {
    // Hydrate calculations with supplier + category so we can group.
    const eligible = await this.hydrateAndFilter(calculations, tx);
    if (eligible.length === 0) return 0;

    // Group by (supplierId, eventType). null supplier collapses to "unassigned".
    const buckets = new Map<string, { supplierId: string | null; eventType: STOCK_EVENT_TYPE; items: StockEventItem[] }>();
    for (const ev of eligible) {
      const key = `${ev.supplierId ?? 'unassigned'}|${ev.eventType}`;
      const entry = buckets.get(key) ?? { supplierId: ev.supplierId, eventType: ev.eventType, items: [] };
      entry.items.push(ev);
      buckets.set(key, entry);
    }

    let dispatched = 0;
    for (const bucket of buckets.values()) {
      const cooldownKey = `supplier:${bucket.supplierId ?? 'unassigned'}:event:${bucket.eventType}`;
      if (await this.isOnCooldown(cooldownKey, tx)) {
        this.logger.debug(`Skipping ${cooldownKey} (24h cooldown active)`);
        continue;
      }
      await this.dispatchBucket(bucket, tx);
      await this.markCooldown(cooldownKey, tx);
      dispatched++;
    }

    this.logger.log(`Dispatched ${dispatched} stock notification bucket(s)`);
    return dispatched;
  }

  // ===== Hydration + filtering =====

  private async hydrateAndFilter(
    calculations: StockCalculationResult[],
    tx: PrismaTransaction,
  ): Promise<Array<StockEventItem & { supplierId: string | null }>> {
    const candidates = calculations
      .map(c => ({ calc: c, eventType: this.determineEventType(c) }))
      .filter((x): x is { calc: StockCalculationResult; eventType: STOCK_EVENT_TYPE } => x.eventType !== null);
    if (candidates.length === 0) return [];

    const items = await tx.item.findMany({
      where: { id: { in: candidates.map(c => c.calc.itemId) } },
      select: {
        id: true,
        name: true,
        uniCode: true,
        supplierId: true,
        category: { select: { type: true } },
      },
    });
    const itemMap = new Map(items.map(i => [i.id, i]));

    const out: Array<StockEventItem & { supplierId: string | null }> = [];
    for (const { calc, eventType } of candidates) {
      const item = itemMap.get(calc.itemId);
      if (!item) continue;
      const categoryType = (item.category?.type ?? null) as ITEM_CATEGORY_TYPE | null;

      // Tool carve-out (spec §11): tools (regular + electronic) are excluded
      // ENTIRELY from stock notifications — no LOW, CRITICAL, OUT_OF_STOCK, or
      // OVERSTOCKED. Tool replenishment surfaces only through the auto-order page.
      if (isToolType(categoryType)) continue;

      out.push({
        itemId: calc.itemId,
        itemName: calc.itemName,
        itemCode: item.uniCode ?? null,
        quantity: calc.finalQuantity,
        previousQuantity: calc.currentQuantity,
        reorderPoint: calc.reorderPoint,
        eventType,
        categoryType,
        supplierId: item.supplierId ?? null,
      });
    }
    return out;
  }

  private determineEventType(calc: StockCalculationResult): STOCK_EVENT_TYPE | null {
    const { stockLevel, finalQuantity, currentQuantity, reorderPoint } = calc;

    if (finalQuantity === 0 && currentQuantity > 0) return STOCK_EVENT_TYPE.OUT_OF_STOCK;
    if (stockLevel === STOCK_LEVEL.CRITICAL) return STOCK_EVENT_TYPE.CRITICAL;
    if (stockLevel === STOCK_LEVEL.LOW) return STOCK_EVENT_TYPE.LOW;
    if (stockLevel === STOCK_LEVEL.OVERSTOCKED) return STOCK_EVENT_TYPE.OVERSTOCKED;
    if (
      stockLevel === STOCK_LEVEL.OPTIMAL &&
      finalQuantity > currentQuantity &&
      reorderPoint != null &&
      currentQuantity < reorderPoint
    ) {
      return STOCK_EVENT_TYPE.REPLENISHED;
    }
    return null;
  }

  // ===== Cooldown (DB-backed, 24h TTL) =====

  private async isOnCooldown(cooldownKey: string, tx: PrismaTransaction): Promise<boolean> {
    const row = await tx.notificationCooldown.findUnique({ where: { cooldownKey } });
    if (!row) return false;
    const elapsed = Date.now() - row.lastSentAt.getTime();
    return elapsed < COOLDOWN_TTL_MS;
  }

  private async markCooldown(cooldownKey: string, tx: PrismaTransaction): Promise<void> {
    const now = new Date();
    await tx.notificationCooldown.upsert({
      where: { cooldownKey },
      create: { cooldownKey, lastSentAt: now },
      update: { lastSentAt: now },
    });
  }

  // ===== Dispatch =====

  private async dispatchBucket(
    bucket: { supplierId: string | null; eventType: STOCK_EVENT_TYPE; items: StockEventItem[] },
    tx: PrismaTransaction,
  ): Promise<void> {
    const supplierName = await this.resolveSupplierName(bucket.supplierId, tx);
    const configKey = this.resolveConfigKey(bucket.eventType);
    const { title, body } = this.buildContent(bucket.eventType, supplierName, bucket.items);
    const importance = this.resolveImportance(bucket.eventType);

    try {
      await this.dispatchService.dispatchByConfiguration(configKey, 'system', {
        entityType: 'Supplier',
        entityId: bucket.supplierId ?? 'unassigned',
        action: bucket.eventType,
        data: {
          supplierId: bucket.supplierId,
          supplierName,
          eventType: bucket.eventType,
          importance,
          title,
          body,
          items: bucket.items.map(i => ({
            itemId: i.itemId,
            itemName: i.itemName,
            itemCode: i.itemCode,
            quantity: i.quantity,
            previousQuantity: i.previousQuantity,
            reorderPoint: i.reorderPoint,
            categoryType: i.categoryType,
            deepLink: this.deepLinkService.generateNotificationActionUrl(
              DeepLinkEntity.Item,
              i.itemId,
            ),
          })),
          // OVERSTOCKED is IN_APP only (spec §9): the dispatcher reads this
          // flag and skips push channels.
          channels: bucket.eventType === STOCK_EVENT_TYPE.OVERSTOCKED ? ['IN_APP'] : null,
          triggeredAt: new Date().toISOString(),
        } as any,
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to dispatch ${configKey} for supplier ${bucket.supplierId}: ${error.message}`,
        error,
      );
    }
  }

  private async resolveSupplierName(
    supplierId: string | null,
    tx: PrismaTransaction,
  ): Promise<string> {
    if (!supplierId) return 'Sem fornecedor';
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { fantasyName: true },
    });
    return supplier?.fantasyName ?? 'Fornecedor';
  }

  private resolveConfigKey(eventType: STOCK_EVENT_TYPE): string {
    switch (eventType) {
      case STOCK_EVENT_TYPE.OUT_OF_STOCK:
        return 'item.out_of_stock';
      case STOCK_EVENT_TYPE.REPLENISHED:
        return 'item.reorder_required';
      case STOCK_EVENT_TYPE.OVERSTOCKED:
        return 'item.overstocked';
      default:
        return 'item.low_stock';
    }
  }

  private resolveImportance(eventType: STOCK_EVENT_TYPE): NOTIFICATION_IMPORTANCE {
    switch (eventType) {
      case STOCK_EVENT_TYPE.OUT_OF_STOCK:
      case STOCK_EVENT_TYPE.CRITICAL:
        return NOTIFICATION_IMPORTANCE.HIGH;
      case STOCK_EVENT_TYPE.LOW:
      case STOCK_EVENT_TYPE.OVERSTOCKED:
        return NOTIFICATION_IMPORTANCE.NORMAL;
      case STOCK_EVENT_TYPE.REPLENISHED:
        return NOTIFICATION_IMPORTANCE.LOW;
      default:
        return NOTIFICATION_IMPORTANCE.NORMAL;
    }
  }

  private buildContent(
    eventType: STOCK_EVENT_TYPE,
    supplierName: string,
    items: StockEventItem[],
  ): { title: string; body: string } {
    const summary =
      items.length === 1
        ? `${items[0].itemName} (${items[0].quantity} un)`
        : `${items.length} itens`;

    switch (eventType) {
      case STOCK_EVENT_TYPE.OUT_OF_STOCK:
        return {
          title: 'Estoque esgotado',
          body: `${supplierName}: ${summary} sem estoque. Reposição urgente necessária.`,
        };
      case STOCK_EVENT_TYPE.CRITICAL:
        return {
          title: 'Estoque crítico',
          body: `${supplierName}: ${summary} atingiu nível crítico.`,
        };
      case STOCK_EVENT_TYPE.LOW:
        return {
          title: 'Estoque baixo',
          body: `${supplierName}: ${summary} com estoque baixo.`,
        };
      case STOCK_EVENT_TYPE.OVERSTOCKED:
        return {
          title: 'Excesso de estoque',
          body: `${supplierName}: ${summary} acima do estoque máximo.`,
        };
      case STOCK_EVENT_TYPE.REPLENISHED:
        return {
          title: 'Estoque reabastecido',
          body: `${supplierName}: ${summary} foi reabastecido.`,
        };
    }
  }

  // ===== Target-user lookup (unchanged contract — kept for dispatch fallback) =====

  async getTargetUsers(tx: PrismaTransaction) {
    return tx.user.findMany({
      where: {
        isActive: true,
        status: { not: 'DISMISSED' },
        sector: {
          privileges: { in: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.WAREHOUSE] },
        },
      },
      select: { id: true, name: true, email: true },
    });
  }
}
