import {
  DashboardChartData,
  DashboardListItem,
  PaintProductionOverview,
  PaintFormulaMetrics,
  PaintComponentInventory,
  PaintColorAnalysis,
  PaintEfficiencyMetrics,
  PaintTrends,
  DateFilter,
  DashboardActivityWhere,
  DashboardOrderWhere,
  DashboardUserWhere,
  DashboardTaskWhere,
  DashboardNotificationWhere,
  TimeSeriesDataPoint,
} from '../../../../../types';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

// Dashboard repository for aggregated data queries
export abstract class DashboardRepository {
  // Inventory dashboard queries
  abstract countItems(where?: any): Promise<number>;
  abstract getItemStatistics(where?: any): Promise<{
    totalValue: number;
    negativeStockItems: number;
    outOfStockItems: number;
    criticalItems: number;
    lowStockItems: number;
    optimalItems: number;
    overstockedItems: number;
    itemsNeedingReorder: number;
  }>;
  abstract getActivityStatistics(where?: DashboardActivityWhere): Promise<{
    totalInbound: number;
    totalOutbound: number;
    movementsByReason: DashboardChartData;
    movementsByOperation: DashboardChartData;
    recentActivities: Array<any>;
  }>;
  abstract getTopItemsByValue(where?: any, limit?: number): Promise<DashboardListItem[]>;
  abstract getTopItemsByActivityCount(where?: any, limit?: number): Promise<DashboardListItem[]>;
  abstract getItemsByLowStockPercentage(where?: any, limit?: number): Promise<DashboardListItem[]>;
  abstract getItemsByCategory(where?: any): Promise<{
    items: DashboardChartData;
    value: DashboardChartData;
  }>;
  abstract getItemsByBrand(where?: any): Promise<DashboardChartData>;
  abstract getItemsPerSupplier(where?: any): Promise<DashboardListItem[]>;
  abstract getOrderCounts(where?: DashboardOrderWhere): Promise<{
    pending: number;
    overdue: number;
  }>;
  abstract getInventoryAlerts(limit: number): Promise<
    Array<{
      itemId: string;
      itemName: string;
      alertType: 'critical' | 'low_stock' | 'overstock';
      currentQuantity: number;
      threshold: number;
    }>
  >;

  // HR dashboard queries
  abstract getEmployeeStatistics(
    where?: DashboardUserWhere,
    dateFilter?: DateFilter,
  ): Promise<{
    total: number;
    active: number;
    inactive: number;
    newHires: number;
  }>;
  abstract getEmployeesByPerformanceLevel(where?: DashboardUserWhere): Promise<DashboardChartData>;
  abstract getEmployeesBySector(where?: DashboardUserWhere): Promise<DashboardChartData>;
  abstract getEmployeesByPosition(where?: DashboardUserWhere): Promise<DashboardChartData>;
  abstract getAveragePerformanceLevel(where?: DashboardUserWhere): Promise<number>;
  abstract getVacationStatistics(dateFilter?: DateFilter): Promise<{
    onVacationNow: number;
    upcoming: number;
    approved: number;
    schedule: Array<any>;
  }>;
  abstract getTaskStatistics(
    where?: DashboardUserWhere,
    dateFilter?: DateFilter,
  ): Promise<{
    created: number;
    byStatus: DashboardChartData;
    completed: number;
    averagePerUser: number;
  }>;
  abstract countVacationsOnDate(date: Date): Promise<number>;
  abstract countTasksInProgress(): Promise<number>;

  // Administration dashboard queries
  abstract getOrderStatistics(where?: any): Promise<{
    total: number;
    byStatus: DashboardChartData;
    pending: number;
    overdue: number;
    withSchedule: number;
  }>;
  abstract getOrdersWithoutNfe(limit: number): Promise<DashboardListItem[]>;
  abstract getTasksWithoutNfe(limit: number): Promise<DashboardListItem[]>;
  abstract getNfeCounts(): Promise<{
    ordersWithNfe: number;
    tasksWithNfe: number;
  }>;
  abstract getCustomerStatistics(customerId?: string): Promise<{
    total: number;
    byType: DashboardChartData;
    topByTasks: DashboardListItem[];
    byCity: DashboardChartData;
    withTags: number;
  }>;
  abstract getSupplierStatistics(supplierId?: string): Promise<{
    total: number;
    withOrders: number;
    topByOrders: DashboardListItem[];
    byState: DashboardChartData;
  }>;
  abstract getTaskOverviewStatistics(where?: any): Promise<{
    total: number;
    byStatus: DashboardChartData;
    withPrice: number;
    totalRevenue: number;
    bySector: DashboardChartData;
  }>;
  abstract getNotificationStatistics(dateFilter?: DateFilter): Promise<{
    total: number;
    byImportance: DashboardChartData;
    sent: number;
    byType: DashboardChartData;
  }>;
  abstract getTotalRevenue(): Promise<number>;
  abstract countMissingNfe(): Promise<number>;

  // Paint dashboard queries
  abstract getProductionOverview(
    baseWhere: any,
    paintIds?: string[],
  ): Promise<PaintProductionOverview>;
  abstract getFormulaMetrics(
    baseWhere: any,
    paintTypeIds?: string[],
    paintIds?: string[],
  ): Promise<PaintFormulaMetrics>;
  abstract getComponentInventory(paintTypeIds?: string[]): Promise<PaintComponentInventory>;
  abstract getColorAnalysis(
    paintTypeIds?: string[],
    manufacturers?: string[],
    includeInactive?: boolean,
  ): Promise<PaintColorAnalysis>;
  abstract getEfficiencyMetrics(baseWhere: any): Promise<PaintEfficiencyMetrics>;
  abstract getTrends(baseWhere: any, paintTypeIds?: string[]): Promise<PaintTrends>;
  abstract countActiveFormulas(): Promise<number>;

  // Production dashboard queries
  abstract getProductionTaskOverview(where?: any): Promise<{
    total: number;
    inProduction: number;
    completed: number;
    cancelled: number;
    preparation: number;
    pending: number;
    averageCompletionHours: number;
  }>;
  abstract getServiceOrderStatistics(where?: any): Promise<{
    total: number;
    pending: number;
    completed: number;
    byType: DashboardChartData;
    byService: Array<{
      serviceName: string;
      count: number;
      percentage: number;
    }>;
    averageServicesPerOrder: number;
  }>;
  abstract getProductionCustomerMetrics(where?: any): Promise<{
    activeCustomers: number;
    topByTasks: DashboardListItem[];
    topByRevenue: DashboardListItem[];
    byType: DashboardChartData;
    byCity: DashboardChartData;
  }>;
  abstract getGarageUtilizationMetrics(garageId?: string): Promise<{
    totalGarages: number;
    totalLanes: number;
    totalParkingSpots: number;
    occupiedSpots: number;
    spotsByGarage: DashboardChartData;
  }>;
  abstract getTruckMetrics(): Promise<{
    total: number;
    inProduction: number;
    byManufacturer: DashboardChartData;
    byPosition: DashboardListItem[];
  }>;
  abstract getCuttingOperationMetrics(where?: any): Promise<{
    totalCuts: number;
    pendingCuts: number;
    completedCuts: number;
    byType: DashboardChartData;
    averageCutTimeHours: number;
  }>;
  abstract getAirbrushingMetrics(where?: any): Promise<{
    totalJobs: number;
    pendingJobs: number;
    completedJobs: number;
    byType: DashboardChartData;
    averageTimeHours: number;
  }>;
  abstract getProductionRevenueAnalysis(where?: any): Promise<{
    totalRevenue: number;
    averageTaskValue: number;
    byMonth: TimeSeriesDataPoint[];
    bySector: DashboardChartData;
    byCustomerType: DashboardChartData;
  }>;
  abstract getProductionProductivityMetrics(
    where?: any,
    timePeriod?: string,
  ): Promise<{
    tasksPerDay: number;
    averageTasksPerUser: number;
    tasksBySector: DashboardChartData;
    tasksByShift: DashboardChartData;
    efficiency: number;
  }>;

  // New methods for administration dashboard
  abstract getUserStatistics(
    where?: DashboardUserWhere,
    dateFilter?: DateFilter,
  ): Promise<{
    total: number;
    active: number;
    inactive: number;
    experiencePeriod1: number;
    experiencePeriod2: number;
    effected: number;
    dismissed: number;
    newUsersThisMonth: number;
    newUsersThisWeek: number;
    newUsersToday: number;
    monthlyGrowth: Array<{ month: string; count: number }>;
  }>;
  abstract getSectorStatistics(): Promise<{
    total: number;
    usersBySector: DashboardChartData;
  }>;
  abstract getBudgetStatistics(dateFilter?: DateFilter): Promise<{
    total: number;
  }>;
  abstract getFileStatistics(): Promise<{
    total: number;
    typeDistribution?: Array<{ type: string; count: number }>;
  }>;
  abstract getUserActivityByRole(): Promise<{
    byRole: DashboardChartData;
  }>;
  abstract getRecentChangeLogs(
    dateFilter?: DateFilter,
    limit?: number,
  ): Promise<
    Array<{
      id: string;
      entityType: string;
      action: string;
      field?: string;
      reason?: string;
      createdAt: Date;
    }>
  >;

  // Additional HR dashboard queries
  abstract countPositions(): Promise<number>;
  abstract countHolidays(): Promise<number>;
  abstract countUpcomingHolidays(): Promise<number>;
  abstract countWarnings(dateFilter?: DateFilter): Promise<number>;
  abstract countActiveWarnings(): Promise<number>;
  abstract countNewWarnings(dateFilter: DateFilter): Promise<number>;
  abstract countPPETypes(): Promise<number>;
  abstract countPPEDeliveriesToday(): Promise<number>;
  abstract countPendingPPEDeliveries(): Promise<number>;
  abstract countPPEDeliveriesThisMonth(dateFilter: DateFilter): Promise<number>;
  abstract countSectors(): Promise<number>;
  abstract getEmployeeCountBySector(): Promise<DashboardListItem[]>;
  abstract getRecentHRActivities(dateFilter: DateFilter, limit: number): Promise<any[]>;
  abstract countTotalVacations(): Promise<number>;
  abstract countPendingVacations(): Promise<number>;
  abstract countNewVacationsToday(): Promise<number>;
  abstract countApprovedVacationsThisMonth(dateFilter: DateFilter): Promise<number>;
}
