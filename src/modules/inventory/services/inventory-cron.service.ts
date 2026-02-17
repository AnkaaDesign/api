import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  ACTIVITY_OPERATION,
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
} from '../../../constants/enums';
import {
  CONSUMPTION_ACTIVITY_REASONS,
  DORMANT_ITEM_MONTHS_THRESHOLD,
  ITEM_SIMILARITY_THRESHOLD,
  MAX_SIMILAR_ITEMS_TO_CHECK,
  getWorkingDaysInMonth,
  getSeasonalFactor,
  STANDARD_WORKING_DAYS_PER_MONTH,
} from '../../../constants/inventory-config';

@Injectable()
export class InventoryCronService {
  private readonly logger = new Logger(InventoryCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  // =====================
  // Monthly Consumption Snapshots
  // =====================

  /**
   * Creates monthly consumption snapshots for all active items.
   * Runs on the 1st of every month at 2 AM.
   *
   * Stores normalized consumption data for:
   * - Year-over-year comparison
   * - Seasonal pattern detection
   * - Historical trend analysis
   */
  @Cron('0 2 1 * *', { timeZone: 'America/Sao_Paulo' })
  async createMonthlyConsumptionSnapshots(): Promise<{
    total: number;
    created: number;
    errors: number;
  }> {
    this.logger.log('Starting monthly consumption snapshot creation...');

    // Snapshot the PREVIOUS month
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // Get all active items
    const activeItems = await this.prisma.item.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let created = 0;
    let errors = 0;

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < activeItems.length; i += batchSize) {
      const batch = activeItems.slice(i, i + batchSize);

      const promises = batch.map(async item => {
        try {
          // Count consumption activities for this item in the target month
          const activities = await this.prisma.activity.findMany({
            where: {
              itemId: item.id,
              operation: ACTIVITY_OPERATION.OUTBOUND,
              reason: { in: CONSUMPTION_ACTIVITY_REASONS as any[] },
              createdAt: { gte: monthStart, lte: monthEnd },
            },
            select: { quantity: true },
          });

          const totalConsumption = activities.reduce((sum, a) => sum + a.quantity, 0);
          const consumptionCount = activities.length;
          const workingDays = getWorkingDaysInMonth(month, year);
          const seasonalFactor = getSeasonalFactor(month);

          // Normalize by working days
          const normalizedConsumption =
            workingDays < STANDARD_WORKING_DAYS_PER_MONTH
              ? totalConsumption * (STANDARD_WORKING_DAYS_PER_MONTH / workingDays)
              : totalConsumption;

          // Upsert the snapshot
          await this.prisma.consumptionSnapshot.upsert({
            where: {
              itemId_year_month: { itemId: item.id, year, month },
            },
            create: {
              itemId: item.id,
              year,
              month,
              totalConsumption,
              consumptionCount,
              normalizedConsumption,
              workingDays,
              seasonalFactor,
            },
            update: {
              totalConsumption,
              consumptionCount,
              normalizedConsumption,
              workingDays,
              seasonalFactor,
            },
          });

          created++;
        } catch (error) {
          errors++;
          this.logger.error(
            `Error creating snapshot for item ${item.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
          );
        }
      });

      await Promise.all(promises);
    }

    this.logger.log(
      `Consumption snapshots complete: ${created} created, ${errors} errors out of ${activeItems.length} items for ${year}-${month + 1}`,
    );

    return { total: activeItems.length, created, errors };
  }

  // =====================
  // Dormant Item Detection & Auto-Disable
  // =====================

  /**
   * Detects dormant items and auto-disables them if a similar active replacement exists.
   * Runs weekly on Sunday at 3 AM.
   *
   * Criteria for dormant:
   * 1. No OUTBOUND consumption activity for DORMANT_ITEM_MONTHS_THRESHOLD months
   * 2. Item is currently active
   * 3. A similar item (by name) exists that IS being used recently
   */
  @Cron('0 3 * * 0', { timeZone: 'America/Sao_Paulo' })
  async detectAndDisableDormantItems(): Promise<{
    scanned: number;
    dormantFound: number;
    autoDisabled: number;
    errors: number;
  }> {
    this.logger.log('Starting dormant item detection...');

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - DORMANT_ITEM_MONTHS_THRESHOLD);

    // Find all active items
    const activeItems = await this.prisma.item.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        categoryId: true,
        brandId: true,
        supplierId: true,
        quantity: true,
        lastUsedAt: true,
      },
    });

    let dormantFound = 0;
    let autoDisabled = 0;
    let errors = 0;

    for (const item of activeItems) {
      try {
        // Check if item has any consumption activity after cutoff
        const recentActivity = await this.prisma.activity.findFirst({
          where: {
            itemId: item.id,
            operation: ACTIVITY_OPERATION.OUTBOUND,
            reason: { in: CONSUMPTION_ACTIVITY_REASONS as any[] },
            createdAt: { gte: cutoffDate },
          },
        });

        if (recentActivity) {
          // Item is active, update lastUsedAt if needed
          if (
            !item.lastUsedAt ||
            new Date(recentActivity.createdAt) > new Date(item.lastUsedAt)
          ) {
            await this.prisma.item.update({
              where: { id: item.id },
              data: { lastUsedAt: recentActivity.createdAt },
            });
          }
          continue;
        }

        // Item is dormant
        dormantFound++;

        // Look for similar active items that ARE being used
        const similarItems = await this.findSimilarActiveItems(
          item.id,
          item.name,
          item.categoryId,
          item.brandId,
          cutoffDate,
        );

        if (similarItems.length > 0) {
          // Found a potential replacement - auto-disable
          const bestMatch = similarItems[0];

          await this.prisma.item.update({
            where: { id: item.id },
            data: {
              isActive: false,
              deactivatedAt: new Date(),
              deactivationReason: `Desativado automaticamente: sem uso por ${DORMANT_ITEM_MONTHS_THRESHOLD} meses. Item similar ativo encontrado: "${bestMatch.name}" (similaridade: ${(bestMatch.similarity * 100).toFixed(0)}%)`,
            },
          });

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ITEM,
            entityId: item.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'isActive',
            oldValue: true,
            newValue: false,
            reason: `Desativado automaticamente: sem uso por ${DORMANT_ITEM_MONTHS_THRESHOLD}+ meses. Possível substituição: "${bestMatch.name}" (${(bestMatch.similarity * 100).toFixed(0)}% similar)`,
            triggeredBy: CHANGE_TRIGGERED_BY.AUTOMATIC_MIN_MAX_UPDATE,
            triggeredById: item.id,
            userId: null,
          });

          autoDisabled++;
          this.logger.log(
            `Auto-disabled dormant item "${item.name}" (${item.id}), replacement: "${bestMatch.name}"`,
          );
        }
      } catch (error) {
        errors++;
        this.logger.error(
          `Error processing dormant check for item ${item.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
      }
    }

    this.logger.log(
      `Dormant item detection complete: ${activeItems.length} scanned, ${dormantFound} dormant found, ${autoDisabled} auto-disabled, ${errors} errors`,
    );

    return {
      scanned: activeItems.length,
      dormantFound,
      autoDisabled,
      errors,
    };
  }

  /**
   * Updates lastUsedAt for all active items based on their most recent consumption activity.
   * Runs daily at 2:30 AM.
   */
  @Cron('30 2 * * *', { timeZone: 'America/Sao_Paulo' })
  async updateLastUsedDates(): Promise<void> {
    this.logger.log('Starting lastUsedAt update for all items...');

    try {
      // Use raw query for efficiency: update lastUsedAt to the max createdAt of consumption activities
      await this.prisma.$executeRaw`
        UPDATE "Item" i
        SET "lastUsedAt" = sub.max_date
        FROM (
          SELECT "itemId", MAX("createdAt") as max_date
          FROM "Activity"
          WHERE "operation" = 'OUTBOUND'
            AND "reason" IN ('PRODUCTION_USAGE', 'PPE_DELIVERY', 'MAINTENANCE', 'PAINT_PRODUCTION', 'EXTERNAL_WITHDRAWAL')
          GROUP BY "itemId"
        ) sub
        WHERE i.id = sub."itemId"
          AND (i."lastUsedAt" IS NULL OR i."lastUsedAt" < sub.max_date)
      `;

      this.logger.log('lastUsedAt update completed');
    } catch (error) {
      this.logger.error('Failed to update lastUsedAt dates:', error);
    }
  }

  // =====================
  // Similarity Detection
  // =====================

  /**
   * Finds similar active items by name using trigram-based similarity.
   * Checks same category/brand first, then broader matches.
   */
  private async findSimilarActiveItems(
    excludeItemId: string,
    itemName: string,
    categoryId: string | null,
    brandId: string | null,
    usedAfterDate: Date,
  ): Promise<Array<{ id: string; name: string; similarity: number }>> {
    // Normalize the item name for comparison
    const normalizedName = this.normalizeName(itemName);
    const nameWords = normalizedName.split(/\s+/).filter(w => w.length > 2);

    if (nameWords.length === 0) {
      return [];
    }

    // Find potentially similar items in the same category
    const candidateWhere: any = {
      id: { not: excludeItemId },
      isActive: true,
    };

    // Prefer same category for better matching
    if (categoryId) {
      candidateWhere.categoryId = categoryId;
    }

    const candidates = await this.prisma.item.findMany({
      where: candidateWhere,
      select: { id: true, name: true },
      take: 100, // Limit candidates to prevent performance issues
    });

    // Calculate similarity scores
    const scored = candidates
      .map(candidate => ({
        id: candidate.id,
        name: candidate.name,
        similarity: this.calculateNameSimilarity(normalizedName, this.normalizeName(candidate.name)),
      }))
      .filter(c => c.similarity >= ITEM_SIMILARITY_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_SIMILAR_ITEMS_TO_CHECK);

    // Verify that the similar items are actually being used recently
    const verifiedSimilar: Array<{ id: string; name: string; similarity: number }> = [];

    for (const candidate of scored) {
      const recentUsage = await this.prisma.activity.findFirst({
        where: {
          itemId: candidate.id,
          operation: ACTIVITY_OPERATION.OUTBOUND,
          reason: { in: CONSUMPTION_ACTIVITY_REASONS as any[] },
          createdAt: { gte: usedAfterDate },
        },
      });

      if (recentUsage) {
        verifiedSimilar.push(candidate);
      }
    }

    return verifiedSimilar;
  }

  /**
   * Normalizes item name for comparison:
   * - Lowercase
   * - Remove special characters
   * - Normalize spaces
   * - Remove common prefixes/suffixes
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s]/g, ' ') // Replace special chars with space
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
  }

  /**
   * Calculates similarity between two normalized names using word overlap (Jaccard similarity).
   * This is simpler and more reliable than Levenshtein for item names like
   * "Parafuso M8 Inox" vs "Parafuso M-8 Inox Polido".
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const words1 = new Set(name1.split(/\s+/).filter(w => w.length > 1));
    const words2 = new Set(name2.split(/\s+/).filter(w => w.length > 1));

    if (words1.size === 0 || words2.size === 0) return 0;

    // Count intersection
    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) {
        intersection++;
      } else {
        // Check for partial matches (e.g., "m8" matches "m-8")
        for (const w2 of words2) {
          if (
            word.includes(w2) ||
            w2.includes(word) ||
            this.levenshteinDistance(word, w2) <= 1
          ) {
            intersection += 0.7; // Partial match
            break;
          }
        }
      }
    }

    // Jaccard-like similarity: intersection / union
    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Simple Levenshtein distance for short strings (word-level comparison).
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }
}
