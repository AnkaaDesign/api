// consumption-analytics.service.ts

import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type {
  ConsumptionAnalyticsResponse,
  ConsumptionItemSimple,
  ConsumptionItemComparison,
  ConsumptionComparisonMode,
  ConsumptionEntityComparison,
} from '../../../types/consumption-analytics';
import type { ConsumptionAnalyticsFormData } from '../../../schemas/consumption-analytics';
import { ACTIVITY_OPERATION } from '../../../constants/enums';
import { Prisma } from '@prisma/client';

@Injectable()
export class ConsumptionAnalyticsService {
  private readonly logger = new Logger(ConsumptionAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get consumption analytics with comparison support
   */
  async getConsumptionAnalytics(
    query: ConsumptionAnalyticsFormData,
  ): Promise<ConsumptionAnalyticsResponse> {
    try {
      // Determine comparison mode
      const mode = this.determineComparisonMode(query);

      // Validate comparison mode
      this.validateComparisonMode(query, mode);

      // Route to appropriate method based on mode
      let data;
      if (mode === 'periods') {
        data = await this.getPeriodComparison(query);
      } else if (mode === 'sectors') {
        data = await this.getSectorComparison(query);
      } else if (mode === 'users') {
        data = await this.getUserComparison(query);
      } else {
        data = await this.getSimpleConsumption(query);
      }

      return {
        success: true,
        message: 'Análise de consumo carregada com sucesso',
        data: {
          mode,
          items: data.items,
          summary: data.summary,
          pagination: data.pagination,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar análise de consumo:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar análise de consumo. Por favor, tente novamente',
      );
    }
  }

  /**
   * Determine the comparison mode based on query parameters
   */
  private determineComparisonMode(query: ConsumptionAnalyticsFormData): ConsumptionComparisonMode {
    const hasPeriodComparison = query.periods && query.periods.length >= 2;
    const hasSectorComparison = query.sectorIds && query.sectorIds.length >= 2;
    const hasUserComparison = query.userIds && query.userIds.length >= 2;

    if (hasPeriodComparison) return 'periods';
    if (hasSectorComparison) return 'sectors';
    if (hasUserComparison) return 'users';
    return 'items';
  }

  /**
   * Validate that comparison mode is correctly configured
   */
  private validateComparisonMode(
    query: ConsumptionAnalyticsFormData,
    mode: ConsumptionComparisonMode,
  ): void {
    // Count active comparison modes
    const hasSectorComparison = query.sectorIds && query.sectorIds.length >= 2;
    const hasUserComparison = query.userIds && query.userIds.length >= 2;
    const hasPeriodComparison = query.periods && query.periods.length >= 2;

    const activeComparisons = [hasSectorComparison, hasUserComparison, hasPeriodComparison].filter(
      Boolean,
    ).length;

    if (activeComparisons > 1) {
      throw new BadRequestException(
        'Não é possível usar múltiplos modos de comparação simultaneamente',
      );
    }
  }

  /**
   * Build operation filter for queries
   */
  private buildOperationFilter(operation: string): Prisma.ActivityWhereInput['operation'] {
    if (operation === 'ALL') {
      return undefined;
    }
    return operation as ACTIVITY_OPERATION;
  }

  /**
   * Get simple consumption (no comparison)
   */
  private async getSimpleConsumption(query: ConsumptionAnalyticsFormData) {
    const {
      startDate,
      endDate,
      sectorIds,
      userIds,
      itemIds,
      brandIds,
      categoryIds,
      offset,
      limit,
      sortBy,
      sortOrder,
      operation,
    } = query;

    // Build where clause
    const where: Prisma.ActivityWhereInput = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      operation: this.buildOperationFilter(operation || ACTIVITY_OPERATION.OUTBOUND),
      ...(itemIds && itemIds.length > 0 && { itemId: { in: itemIds } }),
      ...(sectorIds &&
        sectorIds.length > 0 && {
          user: { sectorId: { in: sectorIds } },
        }),
      ...(userIds &&
        userIds.length > 0 && {
          userId: { in: userIds },
        }),
      ...(brandIds &&
        brandIds.length > 0 && {
          item: { brandId: { in: brandIds } },
        }),
      ...(categoryIds &&
        categoryIds.length > 0 && {
          item: { categoryId: { in: categoryIds } },
        }),
    };

    // Get aggregated data grouped by item using raw SQL for better performance
    const aggregatedData = await this.prisma.$queryRaw<
      Array<{
        itemId: string;
        totalQuantity: number;
        movementCount: bigint;
      }>
    >`
      SELECT
        "itemId",
        SUM("quantity") as "totalQuantity",
        COUNT("id") as "movementCount"
      FROM "Activity"
      WHERE
        "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
        ${operation && operation !== 'ALL' ? Prisma.sql`AND "operation" = ${operation}::"ActivityOperation"` : Prisma.empty}
        ${itemIds && itemIds.length > 0 ? Prisma.sql`AND "itemId" = ANY(${itemIds})` : Prisma.empty}
        ${userIds && userIds.length > 0 ? Prisma.sql`AND "userId" = ANY(${userIds})` : Prisma.empty}
        ${sectorIds && sectorIds.length > 0 ? Prisma.sql`AND "userId" IN (SELECT "id" FROM "User" WHERE "sectorId" = ANY(${sectorIds}))` : Prisma.empty}
        ${brandIds && brandIds.length > 0 ? Prisma.sql`AND "itemId" IN (SELECT "id" FROM "Item" WHERE "brandId" = ANY(${brandIds}))` : Prisma.empty}
        ${categoryIds && categoryIds.length > 0 ? Prisma.sql`AND "itemId" IN (SELECT "id" FROM "Item" WHERE "categoryId" = ANY(${categoryIds}))` : Prisma.empty}
      GROUP BY "itemId"
      ORDER BY
        ${sortBy === 'quantity' ? Prisma.sql`"totalQuantity"` : sortBy === 'name' ? Prisma.sql`"itemId"` : Prisma.sql`"totalQuantity"`}
        ${sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Get total count for pagination
    const totalCount = await this.prisma.activity.count({ where });

    // Get unique item IDs
    const itemIdsToFetch = aggregatedData.map(d => d.itemId);

    // Fetch item details
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIdsToFetch } },
      include: {
        brand: true,
        category: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Create a map for quick lookup
    const itemMap = new Map(items.map(item => [item.id, item]));
    const aggregatedDataMap = new Map(aggregatedData.map(data => [data.itemId, data]));

    // Build consumption items
    const consumptionItems: ConsumptionItemSimple[] = itemIdsToFetch
      .map(itemId => {
        const item = itemMap.get(itemId);
        const data = aggregatedDataMap.get(itemId);

        if (!item || !data) return null;

        const averagePrice = item.prices[0]?.value || 0;
        const totalQuantity = Number(data.totalQuantity);
        const totalValue = totalQuantity * averagePrice;

        return {
          itemId: item.id,
          itemName: item.name,
          itemUniCode: item.uniCode,
          categoryId: item.categoryId,
          categoryName: item.category?.name || null,
          brandId: item.brandId,
          brandName: item.brand?.name || null,
          totalQuantity,
          totalValue,
          movementCount: Number(data.movementCount),
          currentStock: Number(item.quantity),
          averagePrice,
        };
      })
      .filter((item): item is ConsumptionItemSimple => item !== null);

    // Sort by the requested field (name sorting needs to be done after item details are fetched)
    if (sortBy === 'name') {
      consumptionItems.sort((a, b) => {
        const comparison = a.itemName.localeCompare(b.itemName, 'pt-BR');
        return sortOrder === 'asc' ? comparison : -comparison;
      });
    } else if (sortBy === 'value') {
      consumptionItems.sort((a, b) => {
        return sortOrder === 'asc' ? a.totalValue - b.totalValue : b.totalValue - a.totalValue;
      });
    }

    // Calculate summary
    const summary = {
      totalQuantity: consumptionItems.reduce((sum, item) => sum + item.totalQuantity, 0),
      totalValue: consumptionItems.reduce((sum, item) => sum + item.totalValue, 0),
      itemCount: consumptionItems.length,
      averageConsumptionPerItem:
        consumptionItems.length > 0
          ? consumptionItems.reduce((sum, item) => sum + item.totalQuantity, 0) /
            consumptionItems.length
          : 0,
      averageValuePerItem:
        consumptionItems.length > 0
          ? consumptionItems.reduce((sum, item) => sum + item.totalValue, 0) /
            consumptionItems.length
          : 0,
    };

    // Pagination
    const pagination = {
      hasMore: (offset || 0) + (limit || 20) < totalCount,
      offset: offset || 0,
      limit: limit || 20,
      total: totalCount,
    };

    return { items: consumptionItems, summary, pagination };
  }

  /**
   * Get sector comparison data
   */
  private async getSectorComparison(query: ConsumptionAnalyticsFormData) {
    const {
      startDate,
      endDate,
      sectorIds,
      itemIds,
      brandIds,
      categoryIds,
      offset,
      limit,
      sortBy,
      sortOrder,
      operation,
    } = query;

    if (!sectorIds || sectorIds.length < 2) {
      throw new BadRequestException('Comparação de setores requer pelo menos 2 setores');
    }

    // Get aggregated data grouped by item AND sector using raw SQL
    const aggregatedData = await this.prisma.$queryRaw<
      Array<{
        itemId: string;
        sectorId: string;
        sectorName: string;
        quantity: number;
        movementCount: bigint;
      }>
    >`
      SELECT
        a."itemId",
        s."id" as "sectorId",
        s."name" as "sectorName",
        SUM(a."quantity") as "quantity",
        COUNT(a."id") as "movementCount"
      FROM "Activity" a
      INNER JOIN "User" u ON a."userId" = u."id"
      INNER JOIN "Sector" s ON u."sectorId" = s."id"
      WHERE
        a."createdAt" >= ${startDate}
        AND a."createdAt" <= ${endDate}
        AND s."id" = ANY(${sectorIds})
        ${operation && operation !== 'ALL' ? Prisma.sql`AND a."operation" = ${operation}::"ActivityOperation"` : Prisma.empty}
        ${itemIds && itemIds.length > 0 ? Prisma.sql`AND a."itemId" = ANY(${itemIds})` : Prisma.empty}
        ${brandIds && brandIds.length > 0 ? Prisma.sql`AND a."itemId" IN (SELECT "id" FROM "Item" WHERE "brandId" = ANY(${brandIds}))` : Prisma.empty}
        ${categoryIds && categoryIds.length > 0 ? Prisma.sql`AND a."itemId" IN (SELECT "id" FROM "Item" WHERE "categoryId" = ANY(${categoryIds}))` : Prisma.empty}
      GROUP BY a."itemId", s."id", s."name"
      ORDER BY a."itemId", SUM(a."quantity") DESC
    `;

    // Group by item
    const itemsMap = new Map<
      string,
      Map<string, { sectorName: string; quantity: number; movementCount: bigint }>
    >();

    for (const row of aggregatedData) {
      if (!itemsMap.has(row.itemId)) {
        itemsMap.set(row.itemId, new Map());
      }
      itemsMap.get(row.itemId)!.set(row.sectorId, {
        sectorName: row.sectorName,
        quantity: Number(row.quantity),
        movementCount: row.movementCount,
      });
    }

    // Calculate total quantity per item for sorting
    const itemTotals = Array.from(itemsMap.entries()).map(([itemId, sectors]) => {
      const totalQuantity = Array.from(sectors.values()).reduce((sum, s) => sum + s.quantity, 0);
      return { itemId, totalQuantity };
    });

    // Sort by total quantity or name
    if (sortBy === 'quantity' || sortBy === 'value') {
      itemTotals.sort((a, b) => {
        return sortOrder === 'asc'
          ? a.totalQuantity - b.totalQuantity
          : b.totalQuantity - a.totalQuantity;
      });
    }

    // Apply pagination
    const paginatedItemIds = itemTotals
      .slice(offset || 0, (offset || 0) + (limit || 20))
      .map(t => t.itemId);

    // Fetch item details
    const items = await this.prisma.item.findMany({
      where: { id: { in: paginatedItemIds } },
      include: {
        brand: true,
        category: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Create item map
    const itemMap = new Map(items.map(item => [item.id, item]));

    // Build consumption items with comparisons
    const consumptionItems: ConsumptionItemComparison[] = paginatedItemIds
      .map(itemId => {
        const item = itemMap.get(itemId);
        const sectorData = itemsMap.get(itemId);

        if (!item || !sectorData) return null;

        const averagePrice = item.prices[0]?.value || 0;
        const comparisons: ConsumptionEntityComparison[] = [];
        let totalQuantity = 0;

        // Build comparisons for each sector
        for (const [sectorId, data] of sectorData) {
          const quantity = data.quantity;
          const value = quantity * averagePrice;
          totalQuantity += quantity;

          comparisons.push({
            entityId: sectorId,
            entityName: data.sectorName,
            quantity,
            value,
            percentage: 0, // Will be calculated after totals are known
            movementCount: Number(data.movementCount),
          });
        }

        // Calculate percentages
        comparisons.forEach(c => {
          c.percentage = totalQuantity > 0 ? (c.quantity / totalQuantity) * 100 : 0;
        });

        const totalValue = totalQuantity * averagePrice;

        return {
          itemId: item.id,
          itemName: item.name,
          itemUniCode: item.uniCode,
          categoryId: item.categoryId,
          categoryName: item.category?.name || null,
          brandId: item.brandId,
          brandName: item.brand?.name || null,
          totalQuantity,
          totalValue,
          comparisons,
          currentStock: Number(item.quantity),
          averagePrice,
        };
      })
      .filter((item): item is ConsumptionItemComparison => item !== null);

    // Sort by name if requested
    if (sortBy === 'name') {
      consumptionItems.sort((a, b) => {
        const comparison = a.itemName.localeCompare(b.itemName, 'pt-BR');
        return sortOrder === 'asc' ? comparison : -comparison;
      });
    } else if (sortBy === 'value') {
      consumptionItems.sort((a, b) => {
        return sortOrder === 'asc' ? a.totalValue - b.totalValue : b.totalValue - a.totalValue;
      });
    }

    // Calculate summary
    const summary = {
      totalQuantity: consumptionItems.reduce((sum, item) => sum + item.totalQuantity, 0),
      totalValue: consumptionItems.reduce((sum, item) => sum + item.totalValue, 0),
      itemCount: consumptionItems.length,
      entityCount: sectorIds.length,
      averageConsumptionPerItem:
        consumptionItems.length > 0
          ? consumptionItems.reduce((sum, item) => sum + item.totalQuantity, 0) /
            consumptionItems.length
          : 0,
      averageValuePerItem:
        consumptionItems.length > 0
          ? consumptionItems.reduce((sum, item) => sum + item.totalValue, 0) /
            consumptionItems.length
          : 0,
    };

    // Pagination
    const pagination = {
      hasMore: (offset || 0) + (limit || 20) < itemTotals.length,
      offset: offset || 0,
      limit: limit || 20,
      total: itemTotals.length,
    };

    return { items: consumptionItems, summary, pagination };
  }

  /**
   * Get user comparison data
   */
  private async getUserComparison(query: ConsumptionAnalyticsFormData) {
    const {
      startDate,
      endDate,
      userIds,
      itemIds,
      brandIds,
      categoryIds,
      offset,
      limit,
      sortBy,
      sortOrder,
      operation,
    } = query;

    if (!userIds || userIds.length < 2) {
      throw new BadRequestException('Comparação de usuários requer pelo menos 2 usuários');
    }

    // Get aggregated data grouped by item AND user using raw SQL
    const aggregatedData = await this.prisma.$queryRaw<
      Array<{
        itemId: string;
        userId: string;
        userName: string;
        quantity: number;
        movementCount: bigint;
      }>
    >`
      SELECT
        a."itemId",
        u."id" as "userId",
        u."name" as "userName",
        SUM(a."quantity") as "quantity",
        COUNT(a."id") as "movementCount"
      FROM "Activity" a
      INNER JOIN "User" u ON a."userId" = u."id"
      WHERE
        a."createdAt" >= ${startDate}
        AND a."createdAt" <= ${endDate}
        AND u."id" = ANY(${userIds})
        ${operation && operation !== 'ALL' ? Prisma.sql`AND a."operation" = ${operation}::"ActivityOperation"` : Prisma.empty}
        ${itemIds && itemIds.length > 0 ? Prisma.sql`AND a."itemId" = ANY(${itemIds})` : Prisma.empty}
        ${brandIds && brandIds.length > 0 ? Prisma.sql`AND a."itemId" IN (SELECT "id" FROM "Item" WHERE "brandId" = ANY(${brandIds}))` : Prisma.empty}
        ${categoryIds && categoryIds.length > 0 ? Prisma.sql`AND a."itemId" IN (SELECT "id" FROM "Item" WHERE "categoryId" = ANY(${categoryIds}))` : Prisma.empty}
      GROUP BY a."itemId", u."id", u."name"
      ORDER BY a."itemId", SUM(a."quantity") DESC
    `;

    // Group by item
    const itemsMap = new Map<
      string,
      Map<string, { userName: string; quantity: number; movementCount: bigint }>
    >();

    for (const row of aggregatedData) {
      if (!itemsMap.has(row.itemId)) {
        itemsMap.set(row.itemId, new Map());
      }
      itemsMap.get(row.itemId)!.set(row.userId, {
        userName: row.userName,
        quantity: Number(row.quantity),
        movementCount: row.movementCount,
      });
    }

    // Calculate total quantity per item for sorting
    const itemTotals = Array.from(itemsMap.entries()).map(([itemId, users]) => {
      const totalQuantity = Array.from(users.values()).reduce((sum, u) => sum + u.quantity, 0);
      return { itemId, totalQuantity };
    });

    // Sort by total quantity or name
    if (sortBy === 'quantity' || sortBy === 'value') {
      itemTotals.sort((a, b) => {
        return sortOrder === 'asc'
          ? a.totalQuantity - b.totalQuantity
          : b.totalQuantity - a.totalQuantity;
      });
    }

    // Apply pagination
    const paginatedItemIds = itemTotals
      .slice(offset || 0, (offset || 0) + (limit || 20))
      .map(t => t.itemId);

    // Fetch item details
    const items = await this.prisma.item.findMany({
      where: { id: { in: paginatedItemIds } },
      include: {
        brand: true,
        category: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Create item map
    const itemMap = new Map(items.map(item => [item.id, item]));

    // Build consumption items with comparisons
    const consumptionItems: ConsumptionItemComparison[] = paginatedItemIds
      .map(itemId => {
        const item = itemMap.get(itemId);
        const userData = itemsMap.get(itemId);

        if (!item || !userData) return null;

        const averagePrice = item.prices[0]?.value || 0;
        const comparisons: ConsumptionEntityComparison[] = [];
        let totalQuantity = 0;

        // Build comparisons for each user
        for (const [userId, data] of userData) {
          const quantity = data.quantity;
          const value = quantity * averagePrice;
          totalQuantity += quantity;

          comparisons.push({
            entityId: userId,
            entityName: data.userName,
            quantity,
            value,
            percentage: 0, // Will be calculated after totals are known
            movementCount: Number(data.movementCount),
          });
        }

        // Calculate percentages
        comparisons.forEach(c => {
          c.percentage = totalQuantity > 0 ? (c.quantity / totalQuantity) * 100 : 0;
        });

        const totalValue = totalQuantity * averagePrice;

        return {
          itemId: item.id,
          itemName: item.name,
          itemUniCode: item.uniCode,
          categoryId: item.categoryId,
          categoryName: item.category?.name || null,
          brandId: item.brandId,
          brandName: item.brand?.name || null,
          totalQuantity,
          totalValue,
          comparisons,
          currentStock: Number(item.quantity),
          averagePrice,
        };
      })
      .filter((item): item is ConsumptionItemComparison => item !== null);

    // Sort by name if requested
    if (sortBy === 'name') {
      consumptionItems.sort((a, b) => {
        const comparison = a.itemName.localeCompare(b.itemName, 'pt-BR');
        return sortOrder === 'asc' ? comparison : -comparison;
      });
    } else if (sortBy === 'value') {
      consumptionItems.sort((a, b) => {
        return sortOrder === 'asc' ? a.totalValue - b.totalValue : b.totalValue - a.totalValue;
      });
    }

    // Calculate summary
    const summary = {
      totalQuantity: consumptionItems.reduce((sum, item) => sum + item.totalQuantity, 0),
      totalValue: consumptionItems.reduce((sum, item) => sum + item.totalValue, 0),
      itemCount: consumptionItems.length,
      entityCount: userIds.length,
      averageConsumptionPerItem:
        consumptionItems.length > 0
          ? consumptionItems.reduce((sum, item) => sum + item.totalQuantity, 0) /
            consumptionItems.length
          : 0,
      averageValuePerItem:
        consumptionItems.length > 0
          ? consumptionItems.reduce((sum, item) => sum + item.totalValue, 0) /
            consumptionItems.length
          : 0,
    };

    // Pagination
    const pagination = {
      hasMore: (offset || 0) + (limit || 20) < itemTotals.length,
      offset: offset || 0,
      limit: limit || 20,
      total: itemTotals.length,
    };

    return { items: consumptionItems, summary, pagination };
  }

  /**
   * Get period comparison data (compare consumption across different time periods)
   */
  private async getPeriodComparison(query: ConsumptionAnalyticsFormData) {
    const {
      periods,
      sectorIds,
      userIds,
      itemIds,
      brandIds,
      categoryIds,
      offset,
      limit,
      sortBy,
      sortOrder,
      operation,
    } = query;

    if (!periods || periods.length < 2) {
      throw new BadRequestException('Comparação de períodos requer pelo menos 2 períodos');
    }

    // Create a map to store aggregated data by item and period
    const itemsMap = new Map<
      string,
      Map<string, { periodLabel: string; quantity: number; value: number; movementCount: bigint }>
    >();

    // Query each period separately and aggregate
    for (const period of periods) {
      const aggregatedData = await this.prisma.$queryRaw<
        Array<{
          itemId: string;
          totalQuantity: number;
          movementCount: bigint;
        }>
      >`
        SELECT
          "itemId",
          SUM("quantity") as "totalQuantity",
          COUNT("id") as "movementCount"
        FROM "Activity"
        WHERE
          "createdAt" >= ${period.startDate}
          AND "createdAt" <= ${period.endDate}
          ${operation && operation !== 'ALL' ? Prisma.sql`AND "operation" = ${operation}::"ActivityOperation"` : Prisma.empty}
          ${itemIds && itemIds.length > 0 ? Prisma.sql`AND "itemId" = ANY(${itemIds})` : Prisma.empty}
          ${userIds && userIds.length > 0 ? Prisma.sql`AND "userId" = ANY(${userIds})` : Prisma.empty}
          ${sectorIds && sectorIds.length > 0 ? Prisma.sql`AND "userId" IN (SELECT "id" FROM "User" WHERE "sectorId" = ANY(${sectorIds}))` : Prisma.empty}
          ${brandIds && brandIds.length > 0 ? Prisma.sql`AND "itemId" IN (SELECT "id" FROM "Item" WHERE "brandId" = ANY(${brandIds}))` : Prisma.empty}
          ${categoryIds && categoryIds.length > 0 ? Prisma.sql`AND "itemId" IN (SELECT "id" FROM "Item" WHERE "categoryId" = ANY(${categoryIds}))` : Prisma.empty}
        GROUP BY "itemId"
      `;

      // Add results to the map
      for (const row of aggregatedData) {
        if (!itemsMap.has(row.itemId)) {
          itemsMap.set(row.itemId, new Map());
        }
        itemsMap.get(row.itemId)!.set(period.id, {
          periodLabel: period.label,
          quantity: Number(row.totalQuantity),
          value: 0, // Will be calculated after fetching item prices
          movementCount: row.movementCount,
        });
      }
    }

    // Calculate total quantity per item for sorting
    const itemTotals = Array.from(itemsMap.entries()).map(([itemId, periodData]) => {
      const totalQuantity = Array.from(periodData.values()).reduce((sum, p) => sum + p.quantity, 0);
      return { itemId, totalQuantity };
    });

    // Sort by total quantity or name
    if (sortBy === 'quantity' || sortBy === 'value') {
      itemTotals.sort((a, b) => {
        return sortOrder === 'asc'
          ? a.totalQuantity - b.totalQuantity
          : b.totalQuantity - a.totalQuantity;
      });
    }

    // Apply pagination
    const paginatedItemIds = itemTotals
      .slice(offset || 0, (offset || 0) + (limit || 20))
      .map(t => t.itemId);

    // Fetch item details
    const items = await this.prisma.item.findMany({
      where: { id: { in: paginatedItemIds } },
      include: {
        brand: true,
        category: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Create item map
    const itemMap = new Map(items.map(item => [item.id, item]));

    // Build consumption items with comparisons
    const consumptionItems: ConsumptionItemComparison[] = paginatedItemIds
      .map(itemId => {
        const item = itemMap.get(itemId);
        const periodData = itemsMap.get(itemId);

        if (!item || !periodData) return null;

        const averagePrice = item.prices[0]?.value || 0;
        const comparisons: ConsumptionEntityComparison[] = [];
        let totalQuantity = 0;

        // Build comparisons for each period (in order)
        for (const period of periods) {
          const data = periodData.get(period.id);
          const quantity = data ? data.quantity : 0;
          const value = quantity * averagePrice;
          totalQuantity += quantity;

          comparisons.push({
            entityId: period.id,
            entityName: period.label,
            quantity,
            value,
            percentage: 0, // Will be calculated after totals are known
            movementCount: data ? Number(data.movementCount) : 0,
          });
        }

        // Calculate percentages
        comparisons.forEach(c => {
          c.percentage = totalQuantity > 0 ? (c.quantity / totalQuantity) * 100 : 0;
        });

        const totalValue = totalQuantity * averagePrice;

        return {
          itemId: item.id,
          itemName: item.name,
          itemUniCode: item.uniCode,
          categoryId: item.categoryId,
          categoryName: item.category?.name || null,
          brandId: item.brandId,
          brandName: item.brand?.name || null,
          totalQuantity,
          totalValue,
          comparisons,
          currentStock: Number(item.quantity),
          averagePrice,
        };
      })
      .filter((item): item is ConsumptionItemComparison => item !== null);

    // Sort by name if requested
    if (sortBy === 'name') {
      consumptionItems.sort((a, b) => {
        const comparison = a.itemName.localeCompare(b.itemName, 'pt-BR');
        return sortOrder === 'asc' ? comparison : -comparison;
      });
    } else if (sortBy === 'value') {
      consumptionItems.sort((a, b) => {
        return sortOrder === 'asc' ? a.totalValue - b.totalValue : b.totalValue - a.totalValue;
      });
    }

    // Calculate summary
    const summary = {
      totalQuantity: consumptionItems.reduce((sum, item) => sum + item.totalQuantity, 0),
      totalValue: consumptionItems.reduce((sum, item) => sum + item.totalValue, 0),
      itemCount: consumptionItems.length,
      entityCount: periods.length,
      averageConsumptionPerItem:
        consumptionItems.length > 0
          ? consumptionItems.reduce((sum, item) => sum + item.totalQuantity, 0) /
            consumptionItems.length
          : 0,
      averageValuePerItem:
        consumptionItems.length > 0
          ? consumptionItems.reduce((sum, item) => sum + item.totalValue, 0) /
            consumptionItems.length
          : 0,
    };

    // Pagination
    const pagination = {
      hasMore: (offset || 0) + (limit || 20) < itemTotals.length,
      offset: offset || 0,
      limit: limit || 20,
      total: itemTotals.length,
    };

    return { items: consumptionItems, summary, pagination };
  }
}
