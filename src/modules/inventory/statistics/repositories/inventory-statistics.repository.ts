// apps/api/src/modules/inventory/statistics/repositories/inventory-statistics.repository.ts

import type { InventoryConsumptionStatsFormData, ConsumptionDataPoint } from '../../../../schemas/inventory-statistics';
import type { PrismaTransaction } from '@modules/common/base/base.repository';

export interface ConsumptionStatsResult {
  points: ConsumptionDataPoint[];
  summary: {
    totalQuantity: number;
    totalValue?: number;
    totalActivities: number;
    periodDays: number;
    averagePerDay: number;
  };
}

export abstract class InventoryStatisticsRepository {
  abstract getConsumptionStatistics(
    params: InventoryConsumptionStatsFormData,
    tx?: PrismaTransaction
  ): Promise<ConsumptionStatsResult>;
}